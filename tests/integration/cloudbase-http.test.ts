import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createDatabase } from '../../services/api/src/db';
import { HttpError } from '../../services/api/src/security';

type RpcResult = { rows: Record<string, unknown>[]; rowCount: number };
const idFor = (statement: string) => createHash('sha256').update(statement).digest('hex');
const insertUser =
  'INSERT INTO users_profile(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)';
const findUser = 'SELECT id,email,display_name,password_hash FROM users_profile WHERE email=$1';

describe('CloudBase HTTP 查询 RPC 的数据库安全边界', () => {
  let db: PGlite;

  async function claims(value: Record<string, unknown>) {
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify(value)]);
  }

  async function query(id: string, parameters: unknown = []): Promise<RpcResult> {
    const result = await db.query<{ result: RpcResult }>(
      'SELECT public.campusflow_query($1,$2::jsonb) AS result',
      [id, JSON.stringify(parameters)],
    );
    return result.rows[0].result;
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(
      await readFile(resolve('cloudbase/migrations/20261025000000_schema.sql'), 'utf8'),
    );
    // Only the local test engine needs this compatibility function. The cloud
    // migration uses the platform's authenticated JWT helpers without replacing them.
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'
      $$;
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
    `);
    await db.exec(await readFile(resolve('cloudbase/migrations/20261026000000_rpc.sql'), 'utf8'));
    await db.exec(
      await readFile(resolve('cloudbase/migrations/20261026000001_query_catalog.sql'), 'utf8'),
    );
    await db.exec(
      await readFile(resolve('cloudbase/migrations/20261026000002_rpc_errors.sql'), 'utf8'),
    );
  });

  beforeEach(async () => {
    await claims({ role: 'service_role' });
  });

  afterAll(async () => {
    await db?.close();
  });

  it('发布目录仅含 43 条固定查询，查询 ID 是对应 SQL 的 SHA-256', async () => {
    const catalog = await db.query<{ id: string; statement: string }>(
      'SELECT id,statement FROM campusflow_internal.query_catalog ORDER BY id',
    );
    expect(catalog.rows).toHaveLength(43);
    expect(new Set(catalog.rows.map((row) => row.id)).size).toBe(43);
    for (const row of catalog.rows) {
      expect(row.id).toMatch(/^[a-f0-9]{64}$/);
      expect(row.id).toBe(idFor(row.statement));
    }
    expect(await query(idFor('SELECT 1'))).toEqual({ rows: [{ '?column?': 1 }], rowCount: 1 });
  });

  it.each([
    { name: '匿名身份', jwt: { role: 'anon' } },
    { name: '普通用户', jwt: { role: 'authenticated' } },
    { name: '缺失角色', jwt: {} },
    { name: 'NULL 角色', jwt: { role: null } },
  ])('即使以数据库 owner 执行，$name 仍被函数体拒绝', async ({ jwt }) => {
    const owner = await db.query<{ current: string; owner: string }>(
      "SELECT current_user AS current,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='public.campusflow_query(text,jsonb)'::regprocedure",
    );
    expect(owner.rows[0].current).toBe(owner.rows[0].owner);
    await claims(jwt);
    await expect(query(idFor('SELECT 1'))).rejects.toMatchObject({
      code: '42501',
      message: 'Server access required',
    });
    // The identity guard also runs before looking up the query catalog.
    await expect(query('not-an-allowed-query')).rejects.toMatchObject({
      code: '42501',
      message: 'Server access required',
    });
  });

  it('未设置任何 JWT claims 时默认拒绝访问', async () => {
    await db.exec('RESET request.jwt.claims;');
    await expect(query(idFor('SELECT 1'))).rejects.toMatchObject({
      code: '42501',
      message: 'Server access required',
    });
  });

  it('服务身份不能执行未知 hash 或直接提交 SQL 文本', async () => {
    for (const candidate of ['0'.repeat(64), idFor('DELETE FROM users_profile'), 'SELECT 1']) {
      await expect(query(candidate)).rejects.toMatchObject({
        code: '22023',
        message: 'Unknown server query',
      });
    }
    expect((await db.query('SELECT count(*) FROM users_profile')).rows[0]).toEqual({ count: 0 });
  });

  it('含引号、分号、反斜杠和 SQL 占位符的输入只能作为字符串写入', async () => {
    const userId = randomUUID();
    const email = `${userId}@example.test`;
    const malicious = "x'); DELETE FROM users_profile; -- \\ ' $1 $10 中文";
    expect(await query(idFor(insertUser), [userId, email, malicious, null])).toEqual({
      rows: [],
      rowCount: 1,
    });
    expect(await query(idFor(findUser), [email])).toEqual({
      rows: [{ id: userId, email, display_name: malicious, password_hash: null }],
      rowCount: 1,
    });
    expect(
      (await db.query<{ count: number }>('SELECT count(*)::int AS count FROM users_profile'))
        .rows[0].count,
    ).toBe(1);
    await db.query('DELETE FROM users_profile WHERE id=$1', [userId]);
  });

  it('正确区分 $1 与 $10，保留重复参数、NULL、数字、布尔值和 JSON 字符串', async () => {
    const statement =
      'SELECT $1::text AS first,$10::text AS tenth,$2::integer AS number,$3::jsonb AS document,$4::text AS absent,$5::boolean AS enabled,$6::text AS literal,$1::text AS first_again,$7::text AS seven,$8::text AS eight,$9::text AS nine';
    const id = idFor(statement);
    const first = "x'); DELETE FROM users_profile; -- $10";
    const document = { text: "quotes' and $1 and $10", value: 10, missing: null };
    // This fixture tests the SQL renderer with double-digit indexes. It exists
    // only in this transaction; it is never added to the published allowlist.
    await db.exec('BEGIN');
    try {
      await db.query(
        'INSERT INTO campusflow_internal.query_catalog(id,statement,parameter_count,returns_rows) VALUES($1,$2,10,true)',
        [id, statement],
      );
      const result = await query(id, [
        first,
        42,
        JSON.stringify(document),
        null,
        true,
        '$1 $10',
        '7',
        '8',
        '9',
        'tenth',
      ]);
      expect(result).toEqual({
        rows: [
          {
            first,
            tenth: 'tenth',
            number: 42,
            document,
            absent: null,
            enabled: true,
            literal: '$1 $10',
            first_again: first,
            seven: '7',
            eight: '8',
            nine: '9',
          },
        ],
        rowCount: 1,
      });
    } finally {
      await db.exec('ROLLBACK');
    }
    expect(
      (
        await db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM campusflow_internal.query_catalog',
        )
      ).rows[0].count,
    ).toBe(43);
  });

  it('拒绝参数数量、容器类型和非标量值错误，失败时不产生写入', async () => {
    for (const parameters of [null, {}, '[]', [1]]) {
      await expect(query(idFor('SELECT 1'), parameters)).rejects.toMatchObject({ code: '22023' });
    }
    const userId = randomUUID();
    for (const displayName of [{ nested: 'object' }, ['array']]) {
      await expect(
        query(idFor(insertUser), [userId, 'rejected@example.test', displayName, null]),
      ).rejects.toMatchObject({
        code: '22023',
        message: 'Only scalar SQL parameters are supported',
      });
    }
    expect((await db.query('SELECT id FROM users_profile WHERE id=$1', [userId])).rows).toEqual([]);
  });

  it('前向迁移将业务详情写入 MESSAGE，同一错误码保留不同状态和文案', async () => {
    for (const detail of [
      { status: 400, message: '输入不正确: 请检查 "报名字段"。' },
      { status: 409, message: '活动已经变更，请刷新后重试。' },
    ]) {
      let caught: unknown;
      try {
        await db.query('SELECT public.campusflow_rpc_assert(false,$1,$2,$3)', [
          detail.status,
          'INVALID_INPUT',
          detail.message,
        ]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: 'P0001' });
      const { message, detail: pgDetail } = caught as { message: string; detail: string };
      expect(message.startsWith('CF:INVALID_INPUT:')).toBe(true);
      expect(JSON.parse(message.slice('CF:INVALID_INPUT:'.length))).toEqual(detail);
      expect(JSON.parse(pgDetail)).toEqual(detail);
    }
  });

  it('替换错误辅助函数后仍在函数体拒绝非服务身份', async () => {
    await claims({ role: 'anon' });
    await expect(
      db.query("SELECT public.campusflow_rpc_assert(true,400,'INVALID_INPUT','不应到达')"),
    ).rejects.toMatchObject({ code: '42501', message: 'Server credential required' });
  });
});

describe('CloudBase HTTP 适配器的网络和错误边界', () => {
  const serverKey = 'private-test-database-key.must-never-leak';
  const endpoint = 'https://http-test-env.api.tcloudbasegateway.com/v1/rdb/rest/rpc/';

  beforeEach(() => {
    vi.stubEnv('DATABASE_MODE', 'cloudbase-http');
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('CLOUDBASE_ENV_ID', 'http-test-env');
    vi.stubEnv('CLOUDBASE_DATABASE_API_KEY', serverKey);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function failure(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return error as Error;
    }
    throw new Error('Expected the operation to fail');
  }

  it('凭证仅发往固定环境的 Authorization，不在 URL、SQL 参数或响应中出现', async () => {
    const transport = vi
      .fn()
      .mockImplementation(async () => Response.json({ rows: [{ '?column?': 1 }], rowCount: 1 }));
    vi.stubGlobal('fetch', transport);
    const db = await createDatabase({ migrate: false });
    try {
      const result = await db.query('SELECT 1');
      expect(result).toEqual({ rows: [{ '?column?': 1 }], rowCount: 1 });
      expect(transport).toHaveBeenCalledTimes(1);
      const [url, request] = transport.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${endpoint}campusflow_query`);
      expect(new Headers(request.headers).get('Authorization')).toBe(`Bearer ${serverKey}`);
      expect(request.redirect).toBe('error');
      expect(JSON.parse(String(request.body))).toEqual({ p_id: idFor('SELECT 1'), p_params: [] });
      expect(`${url}${request.body}${JSON.stringify(result)}`).not.toContain(serverKey);
      expect(String(request.body)).not.toContain('SELECT 1');
    } finally {
      await db.close();
    }
  });

  it('未知 SQL、任意执行和跨请求事务在联网前拒绝', async () => {
    const transport = vi.fn();
    const transactionBody = vi.fn();
    vi.stubGlobal('fetch', transport);
    const db = await createDatabase({ migrate: false });
    try {
      await expect(db.query('DELETE FROM users_profile')).rejects.toThrow('allowlist');
      await expect(db.execute('DROP TABLE users_profile')).rejects.toThrow('disabled');
      await expect(db.transaction(transactionBody)).rejects.toThrow('named business RPC');
      expect(transport).not.toHaveBeenCalled();
      expect(transactionBody).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it('无密钥或非法环境 ID 时不会将请求发往其他主机', async () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    vi.stubEnv('CLOUDBASE_DATABASE_API_KEY', undefined);
    await expect(createDatabase({ migrate: false })).rejects.toThrow('valid environment');
    vi.stubEnv('CLOUDBASE_DATABASE_API_KEY', serverKey);
    vi.stubEnv('CLOUDBASE_ENV_ID', 'http-test-env@untrusted.example/');
    await expect(createDatabase({ migrate: false })).rejects.toThrow('valid environment');
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { name: '网络失败', error: () => new Error(`Connection failed with ${serverKey}`) },
    {
      name: '请求超时',
      error: () => new DOMException(`Timeout with ${serverKey}`, 'TimeoutError'),
    },
  ])('$name 不泄露连接诊断或凭证', async ({ error }) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error()));
    const db = await createDatabase({ migrate: false });
    try {
      const caught = await failure(db.query('SELECT 1'));
      expect(caught.message).toBe('Database gateway unavailable');
      expect(`${caught}${JSON.stringify(caught)}`).not.toContain(serverKey);
    } finally {
      await db.close();
    }
  });

  it('上游普通错误中的消息、detail、hint 和异常 code 不向调用方回显', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json(
          {
            code: `AUTH_FAILED:${serverKey}`,
            message: `Credential rejected: ${serverKey}`,
            details: `Connection string contains ${serverKey}`,
            hint: `Try secret ${serverKey}`,
          },
          { status: 500 },
        ),
      ),
    );
    const db = await createDatabase({ migrate: false });
    try {
      const caught = await failure(db.query('SELECT 1'));
      expect(caught.message).toBe('Database operation failed');
      expect(`${caught}${JSON.stringify(caught)}`).not.toContain(serverKey);
    } finally {
      await db.close();
    }
  });

  it.each([
    {
      name: '非法 JSON',
      response: () => new Response(`<html>${serverKey}</html>`, { status: 502 }),
      expected: 'Invalid database gateway response',
    },
    {
      name: '错误结果形状',
      response: () => Response.json({ rows: serverKey, rowCount: 0 }),
      expected: 'Invalid database query result',
    },
  ])('$name 产生固定错误而不回显原始内容', async ({ response, expected }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => response()),
    );
    const db = await createDatabase({ migrate: false });
    try {
      const caught = await failure(db.query('SELECT 1'));
      expect(caught.message).toBe(expected);
      expect(`${caught}${JSON.stringify(caught)}`).not.toContain(serverKey);
    } finally {
      await db.close();
    }
  });

  it('已知格式的业务冲突保留 HTTP 状态与用户可理解的消息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json(
          {
            code: 'P0001',
            message: 'CF:FULL',
            details: JSON.stringify({ status: 409, message: '活动名额已满。' }),
          },
          { status: 400 },
        ),
      ),
    );
    const db = await createDatabase({ migrate: false });
    try {
      const caught = await failure(db.mutate('registration.create', {}));
      expect(caught).toBeInstanceOf(HttpError);
      expect(caught).toMatchObject({ statusCode: 409, code: 'FULL', message: '活动名额已满。' });
    } finally {
      await db.close();
    }
  });

  it.each([
    { status: 400, message: '请求字段不正确: 请检查 "名称"。' },
    { status: 409, message: '活动已更新，请刷新后重试。' },
  ])('网关仅返回 MESSAGE 时保留同一业务码的 $status 状态和具体文案', async (detail) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json(
          {
            code: 'DATABASE_P0001',
            message: `CF:INVALID_INPUT:${JSON.stringify(detail)}`,
            requestId: 'synthetic-request-id',
          },
          { status: 400 },
        ),
      ),
    );
    const db = await createDatabase({ migrate: false });
    try {
      const caught = await failure(db.mutate('synthetic-operation', {}));
      expect(caught).toBeInstanceOf(HttpError);
      expect(caught).toMatchObject({
        statusCode: detail.status,
        code: 'INVALID_INPUT',
        message: detail.message,
      });
    } finally {
      await db.close();
    }
  });

  it.each([
    'CF:INVALID_INPUT:{invalid-json',
    `CF:INVALID_INPUT:${JSON.stringify({ status: 500, message: 'internal diagnostic' })}`,
  ])('不回显不合法的内嵌业务错误结构', async (message) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json({ code: 'DATABASE_P0001', message }, { status: 400 }),
        ),
    );
    const db = await createDatabase({ migrate: false });
    try {
      const caught = await failure(db.mutate('synthetic-operation', {}));
      expect(caught.message).toBe('Database operation failed');
      expect(caught).not.toBeInstanceOf(HttpError);
    } finally {
      await db.close();
    }
  });

  it('即使上游误标为业务错误，响应中的服务密钥仍不能泄露', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json(
          {
            code: 'P0001',
            message: 'CF:FULL',
            details: JSON.stringify({ status: 409, message: `Database credential: ${serverKey}` }),
          },
          { status: 400 },
        ),
      ),
    );
    const db = await createDatabase({ migrate: false });
    try {
      const caught = await failure(db.mutate('registration.create', {}));
      expect(`${caught}${JSON.stringify(caught)}`).not.toContain(serverKey);
    } finally {
      await db.close();
    }
  });

  it('内嵌业务错误消息包含服务密钥时仍使用固定错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        Response.json(
          {
            code: 'DATABASE_P0001',
            message: `CF:INVALID_INPUT:${JSON.stringify({ status: 400, message: `Credential ${serverKey}` })}`,
          },
          { status: 400 },
        ),
      ),
    );
    const db = await createDatabase({ migrate: false });
    try {
      const caught = await failure(db.mutate('synthetic-operation', {}));
      expect(caught.message).toBe('Database operation failed');
      expect(`${caught}${JSON.stringify(caught)}`).not.toContain(serverKey);
    } finally {
      await db.close();
    }
  });
});
