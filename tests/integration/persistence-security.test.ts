import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../../services/api/src/app';
import { createDatabase } from '../../services/api/src/db';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('持久化、云认证与数据库权限边界', () => {
  it('关闭进程连接后重新打开，账号和组织仍存在', async () => {
    const base = resolve('.data');
    const dataDir = resolve(base, `persistence-test-${randomUUID()}`, 'postgres');
    const cleanupTarget = resolve(dataDir, '..');
    if (!cleanupTarget.startsWith(`${base}/`) && !cleanupTarget.startsWith(`${base}\\`))
      throw new Error('Unsafe cleanup target');
    await mkdir(dataDir, { recursive: true });
    try {
      const first = await createApp({ dataDir, authMode: 'local' });
      const registered = await first.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'persistent@example.test',
          password: 'persistent-pass-123',
          display_name: '持久化测试',
          organization_name: '持久化测试组织',
        },
      });
      expect(registered.statusCode, registered.body).toBe(201);
      const id = registered.json().organizations[0].id;
      await first.close();
      const second = await createApp({ dataDir, authMode: 'local' });
      try {
        const login = await second.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'persistent@example.test', password: 'persistent-pass-123' },
        });
        expect(login.statusCode, login.body).toBe(200);
        expect(login.json().organizations[0].id).toBe(id);
      } finally {
        await second.close();
      }
    } finally {
      await rm(cleanupTarget, { recursive: true, force: true });
    }
  });
  it('CloudBase 模式只接受已远程验证的 Bearer，不能复用本地会话', async () => {
    vi.stubEnv('CLOUDBASE_ENV_ID', 'test-env');
    const app = await createApp({ dataDir: 'memory://', authMode: 'cloudbase' });
    try {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/auth/session',
            headers: { cookie: 'campusflow_session=old-local-cookie' },
          })
        ).statusCode,
      ).toBe(401);
      const cloudFetch = vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                sub: 'verified-subject',
                email: 'cloud@example.test',
                name: '云认证测试',
                status: 'ACTIVE',
                type: 'USER',
              }),
              { status: 200 },
            ),
        );
      vi.stubGlobal('fetch', cloudFetch);
      const responses = await Promise.all(
        Array.from({ length: 3 }, () =>
          app.inject({
            method: 'GET',
            url: '/api/auth/session',
            headers: { authorization: 'Bearer verified-token' },
          }),
        ),
      );
      expect(
        responses.every((r) => r.statusCode === 200),
        responses.map((r) => r.body).join('\n'),
      ).toBe(true);
      expect(new Set(responses.map((r) => r.json().user.id)).size).toBe(1);
      expect(cloudFetch.mock.calls[0][0]).toBe(
        'https://test-env.api.tcloudbasegateway.com/auth/v1/user/me',
      );
      cloudFetch.mockResolvedValue(new Response('{}', { status: 401 }));
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/auth/session',
            headers: { authorization: 'Bearer revoked-token' },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it('CloudBase 用户被禁用或待激活后立即失去访问权，已激活与默认状态仍可登录', async () => {
    vi.stubEnv('CLOUDBASE_ENV_ID', 'test-env');
    const app = await createApp({ dataDir: 'memory://', authMode: 'cloudbase' });
    let status = 'ACTIVE';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          sub: 'status-checked-subject',
          email: 'status-check@example.test',
          name: '状态验证账号',
          type: 'external',
          status,
        }),
      ),
    );
    const session = () =>
      app.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: { authorization: 'Bearer status-test-token' },
      });
    try {
      const active = await session();
      expect(active.statusCode, active.body).toBe(200);
      const userId = active.json().user.id;
      for (status of ['BLOCKED', 'PENDING', 'DISABLED']) {
        const denied = await session();
        expect(denied.statusCode, status).toBe(401);
        expect(denied.json().error.code).toBe('UNAUTHENTICATED');
      }
      for (status of ['DEFAULT', 'ACTIVE']) {
        const allowed = await session();
        expect(allowed.statusCode, status).toBe(200);
        expect(allowed.json().user.id).toBe(userId);
      }
    } finally {
      await app.close();
    }
  });
  it('RLS 迁移实际限制跨组织查询，并阻止客户端读取报名秘密或写入活动', async () => {
    const db = await createDatabase({ dataDir: 'memory://' });
    try {
      await db.execute('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
      const own = randomUUID(),
        other = randomUUID(),
        ownOrg = randomUUID(),
        otherOrg = randomUUID();
      await db.query(
        'INSERT INTO users_profile(id,email,display_name,cloudbase_subject) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
        [
          own,
          'rls-one@example.test',
          'RLS甲',
          'subject-one',
          other,
          'rls-two@example.test',
          'RLS乙',
          'subject-two',
        ],
      );
      await db.query('INSERT INTO organizations(id,name,created_by) VALUES($1,$2,$3),($4,$5,$6)', [
        ownOrg,
        '组织甲',
        own,
        otherOrg,
        '组织乙',
        other,
      ]);
      await db.query(
        'INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,$3),($4,$5,$6)',
        [ownOrg, own, 'Owner', otherOrg, other, 'Owner'],
      );
      await db.execute(await readFile(resolve('cloudbase/migrations/20261025000001_rls.sql'), 'utf8'));
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: 'subject-one' }),
      ]);
      await db.execute('SET ROLE authenticated;');
      const visible = await db.query('SELECT id FROM organizations');
      expect(visible.rows.map((r) => r.id)).toEqual([ownOrg]);
      await expect(db.query('SELECT token_hash FROM registrations')).rejects.toThrow();
      await expect(db.query('SELECT password_hash FROM users_profile')).rejects.toThrow();
      await expect(
        db.query('DELETE FROM activities WHERE organization_id=$1', [ownOrg]),
      ).rejects.toThrow();
      await db.execute('RESET ROLE; SET ROLE anon;');
      await expect(db.query('SELECT * FROM organizations')).rejects.toThrow();
      await db.execute('RESET ROLE;');
    } finally {
      await db.close();
    }
  });
});
