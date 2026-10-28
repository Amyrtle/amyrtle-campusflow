import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import {
  activityInputSchema,
  activityStatuses,
  authSchema,
  formulaSafe,
  planSchema,
  registrationSchema,
  surveyQuestionSchema,
  type Activity,
  type Analytics,
  type Role,
  type User,
} from '@campusflow/shared';
import { createDatabase, type Database, type Sql } from './db.js';
import {
  assert,
  digest,
  getSecret,
  hashPassword,
  HttpError,
  randomToken,
  ticketToken,
  verifyPassword,
} from './security.js';
import { generatePlan, liveText } from './ai.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}
type Options = {
  dataDir?: string;
  databaseUrl?: string;
  logger?: boolean;
  authMode?: 'local' | 'cloudbase';
};
type RegistrationMutationResult = {
  created: boolean;
  registration_id: string;
  activity_id: string;
  display_name: string;
  title: string;
  start_time: string;
  location: string;
};
const uuid = z.string().uuid();
const activitySelect = `SELECT a.*, (SELECT count(*)::int FROM checkin_records c WHERE c.activity_id=a.id) AS checkin_count FROM activities a`;
const managerRoles: Role[] = ['Owner', 'Admin'];
const params = (req: FastifyRequest) => req.params as Record<string, string>;
const idParam = (req: FastifyRequest, name = 'id') => uuid.parse(params(req)[name]);
const sortedAnswers = (answers: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)));

export async function createApp(options: Options = {}) {
  const hasHttpDatabase =
    process.env.DATABASE_MODE === 'cloudbase-http' &&
    Boolean(process.env.CLOUDBASE_ENV_ID && process.env.CLOUDBASE_DATABASE_API_KEY);
  if (
    process.env.NODE_ENV === 'production' &&
    !(options.databaseUrl ?? process.env.DATABASE_URL) &&
    !hasHttpDatabase
  )
    throw new Error('Production requires DATABASE_URL or configured CloudBase HTTP database');
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN)
    throw new Error('Production requires APP_ORIGIN');
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 100_000,
    trustProxy: process.env.TRUST_PROXY === 'true',
  });
  const db = await createDatabase(options);
  app.decorate('db', db);
  const secret = await getSecret(options.dataDir);
  const authMode =
    options.authMode ?? (process.env.AUTH_MODE === 'cloudbase' ? 'cloudbase' : 'local');
  const corsManagedByGateway = process.env.CORS_MANAGED_BY_GATEWAY === 'true';
  if (process.env.NODE_ENV === 'production' && authMode !== 'cloudbase') {
    await db.close();
    throw new Error('Production requires AUTH_MODE=cloudbase');
  }
  if (authMode === 'cloudbase' && !process.env.CLOUDBASE_ENV_ID) {
    await db.close();
    throw new Error('CloudBase authentication requires CLOUDBASE_ENV_ID');
  }
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: authMode === 'cloudbase' ? 3600 : 43200,
  };
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试。' },
    }),
  });
  app.addHook('onClose', async () => {
    await db.close();
  });
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    const expected = process.env.APP_ORIGIN;
    const origins = new Set(
      expected
        ? expected.split(',').map((s) => s.trim())
        : [
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'http://localhost:4173',
            'http://127.0.0.1:4173',
            'http://localhost:3001',
            'http://127.0.0.1:3001',
          ],
    );
    if (origin) {
      assert(origins.has(origin), 403, 'ORIGIN_FORBIDDEN', '该请求来源未获授权。');
      reply.header('Vary', 'Origin');
      if (!corsManagedByGateway)
        reply
          .header('Access-Control-Allow-Origin', origin)
          .header('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS' && req.url.startsWith('/api/')) {
      assert(origin, 403, 'ORIGIN_REQUIRED', '预检请求需要有效来源。');
      const requestedHeaders = String(req.headers['access-control-request-headers'] ?? '')
        .toLowerCase()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      assert(
        requestedHeaders.every((header) => ['authorization', 'content-type'].includes(header)),
        400,
        'CORS_HEADERS',
        '预检请求包含未允许的请求头。',
      );
      if (!corsManagedByGateway)
        reply
          .header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
          .header('Access-Control-Allow-Headers', 'Authorization,Content-Type')
          .header('Access-Control-Max-Age', '600');
      return reply.code(204).send();
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !origin) {
      assert(
        req.headers['sec-fetch-site'] !== 'cross-site',
        403,
        'CSRF_REJECTED',
        '跨站请求已拒绝。',
      );
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.issues[0]?.message ?? '输入内容不正确。',
          details: error.flatten(),
        },
      });
    if (error instanceof HttpError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    const raw = error as { code?: string; statusCode?: number };
    if (raw.code === '23505')
      return reply
        .code(409)
        .send({ error: { code: 'CONFLICT', message: '记录已存在，请刷新后重试。' } });
    if (raw.statusCode === 429)
      return reply
        .code(429)
        .send({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试。' } });
    if (raw.statusCode && raw.statusCode < 500)
      return reply
        .code(raw.statusCode)
        .send({ error: { code: 'BAD_REQUEST', message: '请求格式不正确。' } });
    req.log.error({ code: raw.code ?? 'INTERNAL', requestId: req.id }, 'Request failed');
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时无法处理请求，请稍后重试。' } });
  });

  async function audit(
    sql: Sql,
    organizationId: string | null,
    actorId: string | null,
    action: string,
    entityId?: string,
  ) {
    await sql.query(
      'INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_id) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), organizationId, actorId, action, entityId ?? null],
    );
  }
  async function cloudUser(accessToken: string): Promise<User> {
    assert(authMode === 'cloudbase', 400, 'AUTH_MODE', '当前环境未启用 CloudBase 登录。');
    let response: Response;
    try {
      response = await fetch(
        `https://${process.env.CLOUDBASE_ENV_ID}.api.tcloudbasegateway.com/auth/v1/user/me`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) },
      );
    } catch {
      throw new HttpError(503, 'AUTH_UNAVAILABLE', '身份服务暂不可用。');
    }
    assert(response.ok, 401, 'UNAUTHENTICATED', '登录凭证已失效，请重新登录。');
    const profile = (await response.json()) as {
      sub?: string;
      name?: string;
      email?: string;
      status?: string;
      type?: string;
    };
    assert(
      profile.sub &&
        profile.email &&
        profile.type !== 'ANONYMOUS' &&
        !['BLOCKED', 'PENDING', 'DISABLED'].includes(profile.status ?? ''),
      401,
      'UNAUTHENTICATED',
      '需要有效邮箱账号。',
    );
    const known = await db.query<User>(
      'SELECT id,email,display_name FROM users_profile WHERE cloudbase_subject=$1',
      [String(profile.sub)],
    );
    if (known.rows[0]) return known.rows[0];
    const user: User = {
      id: randomUUID(),
      email: profile.email.toLowerCase(),
      display_name: profile.name || profile.email.split('@')[0],
    };
    await db.query(
      'INSERT INTO users_profile(id,email,display_name,cloudbase_subject) VALUES($1,$2,$3,$4) ON CONFLICT(cloudbase_subject) DO NOTHING',
      [user.id, user.email, user.display_name, String(profile.sub)],
    );
    return (
      await db.query<User>(
        'SELECT id,email,display_name FROM users_profile WHERE cloudbase_subject=$1',
        [String(profile.sub)],
      )
    ).rows[0];
  }
  async function user(req: FastifyRequest): Promise<User> {
    if (authMode === 'cloudbase') {
      const authorization = req.headers.authorization;
      assert(
        authorization && authorization.startsWith('Bearer '),
        401,
        'UNAUTHENTICATED',
        '请通过 CloudBase 登录。',
      );
      return cloudUser(authorization.slice(7));
    }
    const token = req.cookies.campusflow_session;
    assert(token, 401, 'UNAUTHENTICATED', '请先登录。');
    const result = await db.query<User>(
      'SELECT u.id,u.email,u.display_name FROM sessions s JOIN users_profile u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [digest(token)],
    );
    assert(result.rows[0], 401, 'UNAUTHENTICATED', '登录状态已过期。');
    return result.rows[0];
  }
  async function session(current: User) {
    const result = await db.query(
      'SELECT o.id,o.name,m.role FROM organizations o JOIN organization_members m ON m.organization_id=o.id WHERE m.user_id=$1 ORDER BY o.created_at',
      [current.id],
    );
    return { user: current, organizations: result.rows, mode: authMode };
  }
  async function setSession(current: User, reply: FastifyReply) {
    const token = randomToken();
    await db.query('DELETE FROM sessions WHERE expires_at < now()');
    await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [
      digest(token),
      current.id,
      new Date(Date.now() + cookieOptions.maxAge * 1000),
    ]);
    reply.setCookie('campusflow_session', token, cookieOptions);
    return session(current);
  }
  async function membership(current: User, orgId: string, allowed?: Role[]) {
    const result = await db.query<{ role: Role }>(
      'SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2',
      [orgId, current.id],
    );
    const member = result.rows[0];
    assert(
      member && (!allowed || allowed.includes(member.role)),
      403,
      'FORBIDDEN',
      '没有操作该组织数据的权限。',
    );
    return member.role;
  }
  async function getActivity(id: string, sql: Sql = db): Promise<Activity> {
    const result = await sql.query<Activity>(`${activitySelect} WHERE a.id=$1`, [id]);
    assert(result.rows[0], 404, 'NOT_FOUND', '活动不存在。');
    return result.rows[0];
  }
  async function authorizeActivity(req: FastifyRequest, allowed?: Role[]) {
    const current = await user(req);
    const activity = await getActivity(idParam(req));
    const role = await membership(current, activity.organization_id, allowed);
    if (role === 'Staff') {
      const assigned = await db.query(
        'SELECT 1 FROM activity_staff WHERE activity_id=$1 AND user_id=$2',
        [activity.id, current.id],
      );
      assert(assigned.rows.length, 403, 'FORBIDDEN', '您尚未分配到该活动。');
    }
    return { current, activity, role };
  }
  async function createOrganization(current: User, name: string) {
    const id = randomUUID();
    await db.mutate('organization_create', { id, name, actor_id: current.id });
    return { id, name, role: 'Owner' as const };
  }

  app.get('/api/health', async (_request, reply) => {
    try {
      await db.query('SELECT 1');
      return {
        status: 'ok',
        database: db.kind,
        auth_mode: authMode,
        ai_mode: process.env.MOCK_AI_MODE === 'false' ? 'live' : 'mock',
      };
    } catch {
      return reply.code(503).send({ status: 'unavailable', code: 'DATABASE_UNAVAILABLE' });
    }
  });
  app.get('/api/auth/session', async (req) => session(await user(req)));
  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      assert(authMode === 'local', 400, 'AUTH_MODE', '请通过 CloudBase 邮箱认证注册。');
      const input = authSchema.parse(req.body);
      const current: User = {
        id: randomUUID(),
        email: input.email.toLowerCase(),
        display_name: input.display_name ?? input.email.split('@')[0],
      };
      await db.query(
        'INSERT INTO users_profile(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
        [current.id, current.email, current.display_name, hashPassword(input.password)],
      );
      if (input.organization_name) await createOrganization(current, input.organization_name);
      reply.code(201);
      return setSession(current, reply);
    },
  );
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      assert(authMode === 'local', 400, 'AUTH_MODE', '请通过 CloudBase 邮箱认证登录。');
      const input = authSchema.parse(req.body);
      const found = await db.query<User & { password_hash: string }>(
        'SELECT id,email,display_name,password_hash FROM users_profile WHERE email=$1',
        [input.email.toLowerCase()],
      );
      const row = found.rows[0];
      assert(
        verifyPassword(
          input.password,
          row?.password_hash ?? '00000000000000000000000000000000:' + '0'.repeat(128),
        ) && row,
        401,
        'INVALID_CREDENTIALS',
        '邮箱或密码不正确。',
      );
      return setSession({ id: row.id, email: row.email, display_name: row.display_name }, reply);
    },
  );
  app.post('/api/auth/cloudbase', async (req) => {
    const input = z
      .object({
        access_token: z.string().min(10).max(10000),
        organization_name: z.string().min(2).max(100).optional(),
      })
      .parse(req.body);
    const current = await cloudUser(input.access_token);
    if (input.organization_name) {
      const s = await session(current);
      if (!s.organizations.length) await createOrganization(current, input.organization_name);
    }
    return session(current);
  });
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.cookies.campusflow_session)
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [
        digest(req.cookies.campusflow_session),
      ]);
    reply.clearCookie('campusflow_session', { path: '/' });
    return { ok: true };
  });
  app.patch('/api/auth/profile', async (req) => {
    const current = await user(req);
    const input = z.object({ display_name: z.string().trim().min(1).max(80) }).parse(req.body);
    await db.query('UPDATE users_profile SET display_name=$1,updated_at=now() WHERE id=$2', [
      input.display_name,
      current.id,
    ]);
    return { ...current, display_name: input.display_name };
  });
  app.get('/api/organizations', async (req) => (await session(await user(req))).organizations);
  app.post('/api/organizations', async (req, reply) => {
    const current = await user(req);
    const { name } = z.object({ name: z.string().trim().min(2).max(100) }).parse(req.body);
    reply.code(201);
    return createOrganization(current, name);
  });
  app.get('/api/organizations/:orgId/members', async (req) => {
    const current = await user(req);
    const org = idParam(req, 'orgId');
    await membership(current, org, managerRoles);
    return (
      await db.query(
        'SELECT u.id AS user_id,u.email,u.display_name,m.role FROM organization_members m JOIN users_profile u ON u.id=m.user_id WHERE m.organization_id=$1 ORDER BY m.created_at',
        [org],
      )
    ).rows;
  });
  app.post('/api/organizations/:orgId/members', async (req, reply) => {
    const current = await user(req);
    const org = idParam(req, 'orgId');
    const role = await membership(current, org, managerRoles);
    const input = z
      .object({ email: z.string().email().max(200), role: z.enum(['Admin', 'Staff', 'Viewer']) })
      .parse(req.body);
    assert(
      role === 'Owner' || input.role !== 'Admin',
      403,
      'FORBIDDEN',
      '仅组织所有者可以邀请管理员。',
    );
    const token = randomToken();
    const id = randomUUID();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    await db.query(
      'INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, org, input.email.toLowerCase(), input.role, digest(token), expires],
    );
    await audit(db, org, current.id, 'member.invited', id);
    reply.code(201);
    return { id, token, expires_at: expires };
  });
  app.post('/api/organizations/join', async (req) => {
    const current = await user(req);
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    return db.mutate<{ ok: true; organization_id: string }>('organization_join', {
      token_hash: digest(token),
      actor_id: current.id,
      email: current.email,
    });
  });
  app.patch('/api/organizations/:orgId/members/:userId', async (req) => {
    const current = await user(req);
    const org = idParam(req, 'orgId');
    const target = idParam(req, 'userId');
    await membership(current, org, ['Owner']);
    const { role } = z.object({ role: z.enum(['Admin', 'Staff', 'Viewer']) }).parse(req.body);
    assert(target !== current.id, 400, 'OWNER_PROTECTED', '不能通过此操作移除自己的所有者身份。');
    const result = await db.query(
      'UPDATE organization_members SET role=$1 WHERE organization_id=$2 AND user_id=$3 AND role<>$4 RETURNING user_id',
      [role, org, target, 'Owner'],
    );
    assert(result.rows.length, 404, 'NOT_FOUND', '成员不存在或受到保护。');
    await audit(db, org, current.id, 'member.role_changed', target);
    return { ok: true };
  });
  app.delete('/api/organizations/:orgId/members/:userId', async (req) => {
    const current = await user(req);
    const org = idParam(req, 'orgId');
    const target = idParam(req, 'userId');
    await membership(current, org, ['Owner']);
    const result = await db.query(
      'DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2 AND role<>$3 RETURNING user_id',
      [org, target, 'Owner'],
    );
    assert(result.rows.length, 404, 'NOT_FOUND', '成员不存在或受到保护。');
    await db.query(
      'DELETE FROM activity_staff WHERE user_id=$1 AND activity_id IN (SELECT id FROM activities WHERE organization_id=$2)',
      [target, org],
    );
    await audit(db, org, current.id, 'member.removed', target);
    return { ok: true };
  });

  app.get('/api/organizations/:orgId/activities', async (req) => {
    const current = await user(req);
    const org = idParam(req, 'orgId');
    const role = await membership(current, org);
    return (
      await db.query(
        `${activitySelect} WHERE a.organization_id=$1${role === 'Staff' ? ' AND EXISTS(SELECT 1 FROM activity_staff s WHERE s.activity_id=a.id AND s.user_id=$2)' : ''} ORDER BY a.created_at DESC`,
        role === 'Staff' ? [org, current.id] : [org],
      )
    ).rows;
  });
  app.post('/api/organizations/:orgId/activities', async (req, reply) => {
    const current = await user(req);
    const org = idParam(req, 'orgId');
    await membership(current, org, managerRoles);
    const input = activityInputSchema.parse(req.body);
    const id = randomUUID();
    const slug = randomUUID().slice(0, 12);
    await db.mutate('activity_create', {
      id,
      slug,
      organization_id: org,
      actor_id: current.id,
      activity: input,
    });
    reply.code(201);
    return getActivity(id);
  });
  app.get('/api/activities/:id', async (req) => (await authorizeActivity(req)).activity);
  app.patch('/api/activities/:id', async (req) => {
    const { current, activity } = await authorizeActivity(req, managerRoles);
    const input = activityInputSchema.parse(req.body);
    assert(
      !['Archived', 'Cancelled', 'Completed'].includes(activity.status),
      409,
      'ACTIVITY_LOCKED',
      '当前状态不能编辑活动。',
    );
    assert(
      input.capacity >= activity.registration_count,
      409,
      'CAPACITY_TOO_SMALL',
      '容量不能小于已报名人数。',
    );
    await db.mutate('activity_update', {
      id: activity.id,
      actor_id: current.id,
      activity: input,
    });
    return getActivity(activity.id);
  });
  app.post('/api/activities/:id/status', async (req) => {
    const { current, activity } = await authorizeActivity(req, managerRoles);
    const { status } = z.object({ status: z.enum(activityStatuses) }).parse(req.body);
    await db.mutate('activity_status', {
      id: activity.id,
      actor_id: current.id,
      status,
    });
    return getActivity(activity.id);
  });
  app.delete('/api/activities/:id', async (req) => {
    const { current, activity } = await authorizeActivity(req, managerRoles);
    await db.mutate('activity_delete', { id: activity.id, actor_id: current.id });
    return { ok: true };
  });
  app.get('/api/activities/:id/staff', async (req) => {
    const { activity } = await authorizeActivity(req, managerRoles);
    return (
      await db.query(
        'SELECT u.id AS user_id,u.email,u.display_name FROM activity_staff s JOIN users_profile u ON u.id=s.user_id WHERE s.activity_id=$1',
        [activity.id],
      )
    ).rows;
  });
  app.post('/api/activities/:id/staff', async (req) => {
    const { current, activity } = await authorizeActivity(req, managerRoles);
    const { user_id } = z.object({ user_id: uuid }).parse(req.body);
    const member = (
      await db.query(
        'SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2',
        [activity.organization_id, user_id],
      )
    ).rows[0];
    assert(member?.role === 'Staff', 400, 'NOT_STAFF', '只能分配本组织的工作人员。');
    await db.query(
      'INSERT INTO activity_staff(activity_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [activity.id, user_id],
    );
    await audit(db, activity.organization_id, current.id, 'activity.staff_assigned', user_id);
    return { ok: true };
  });
  app.delete('/api/activities/:id/staff/:userId', async (req) => {
    const { activity } = await authorizeActivity(req, managerRoles);
    await db.query('DELETE FROM activity_staff WHERE activity_id=$1 AND user_id=$2', [
      activity.id,
      idParam(req, 'userId'),
    ]);
    return { ok: true };
  });

  app.get('/api/public/events/:slug', async (req) => {
    const slug = z.string().max(100).parse(params(req).slug);
    const activity = (
      await db.query<Activity>(`${activitySelect} WHERE a.slug=$1 AND a.status<>$2`, [
        slug,
        'Draft',
      ])
    ).rows[0];
    assert(activity, 404, 'NOT_FOUND', '活动尚未发布或不存在。');
    return {
      id: activity.id,
      slug: activity.slug,
      title: activity.title,
      description: activity.description,
      category: activity.category,
      location: activity.location,
      start_time: activity.start_time,
      end_time: activity.end_time,
      registration_start: activity.registration_start,
      registration_deadline: activity.registration_deadline,
      capacity: activity.capacity,
      status: activity.status,
      cover_image: activity.cover_image,
      form_fields: activity.form_fields,
      registration_count: activity.registration_count,
      remaining: Math.max(0, activity.capacity - activity.registration_count),
    };
  });
  app.post(
    '/api/public/events/:slug/register',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = registrationSchema.parse(req.body);
      const slug = z.string().max(100).parse(params(req).slug);
      const requestHash = digest(
        JSON.stringify({ display_name: input.display_name, answers: sortedAnswers(input.answers) }),
      );
      const activity = (
        await db.query<{ id: string }>('SELECT id FROM activities WHERE slug=$1', [slug])
      ).rows[0];
      assert(activity, 404, 'NOT_FOUND', '活动不存在。');
      const token = ticketToken(secret, activity.id, input.idempotency_key);
      const result = await db.mutate<RegistrationMutationResult>('registration_create', {
        activity_id: activity.id,
        slug,
        display_name: input.display_name,
        answers: input.answers,
        idempotency_key: input.idempotency_key,
        request_hash: requestHash,
        token_hash: digest(token),
      });
      const { created, ...ticket } = result;
      if (created) reply.code(201);
      return { ...ticket, token };
    },
  );
  app.get('/api/activities/:id/registrations', async (req) => {
    const { activity } = await authorizeActivity(req, ['Owner', 'Admin', 'Staff']);
    return (
      await db.query(
        'SELECT r.id,r.activity_id,r.display_name,r.answers,r.created_at,c.checked_in_at FROM registrations r LEFT JOIN checkin_records c ON c.registration_id=r.id WHERE r.activity_id=$1 ORDER BY r.created_at DESC',
        [activity.id],
      )
    ).rows;
  });
  app.delete('/api/activities/:id/registrations/:registrationId', async (req) => {
    const { current, activity } = await authorizeActivity(req, managerRoles);
    const registrationId = idParam(req, 'registrationId');
    return db.mutate<{ ok: true }>('registration_delete', {
      activity_id: activity.id,
      registration_id: registrationId,
      actor_id: current.id,
    });
  });
  app.post('/api/activities/:id/checkin', async (req) => {
    const { current, activity } = await authorizeActivity(req, ['Owner', 'Admin', 'Staff']);
    const { token } = z.object({ token: z.string().min(10).max(500) }).parse(req.body);
    return db.mutate('checkin', {
      activity_id: activity.id,
      actor_id: current.id,
      token_hash: digest(token),
    });
  });
  app.delete('/api/public/events/:slug/registration', async (req) => {
    const { token } = z.object({ token: z.string().min(10).max(500) }).parse(req.body);
    const slug = z.string().max(100).parse(params(req).slug);
    return db.mutate<{ ok: true }>('registration_cancel', { slug, token_hash: digest(token) });
  });

  async function analytics(activity: Activity): Promise<Analytics> {
    const totals = (
      await db.query(
        'SELECT (SELECT count(*)::int FROM registrations WHERE activity_id=$1) AS registrations,(SELECT count(*)::int FROM checkin_records WHERE activity_id=$1) AS checkins',
        [activity.id],
      )
    ).rows[0];
    const registration_trend = (
      await db.query<{ date: string; count: number }>(
        "SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,count(*)::int AS count FROM registrations WHERE activity_id=$1 GROUP BY 1 ORDER BY 1",
        [activity.id],
      )
    ).rows;
    const checkin_trend = (
      await db.query<{ date: string; count: number }>(
        "SELECT to_char(checked_in_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:00') AS date,count(*)::int AS count FROM checkin_records WHERE activity_id=$1 GROUP BY 1 ORDER BY 1",
        [activity.id],
      )
    ).rows;
    return {
      registration_count: totals.registrations,
      checkin_count: totals.checkins,
      absent_count: totals.registrations - totals.checkins,
      remaining: Math.max(0, activity.capacity - totals.registrations),
      checkin_rate: totals.registrations
        ? Math.round((totals.checkins / totals.registrations) * 10000) / 100
        : 0,
      registration_trend,
      checkin_trend,
    };
  }
  app.get('/api/activities/:id/analytics', async (req) =>
    analytics((await authorizeActivity(req)).activity),
  );
  app.get('/api/activities/:id/export.csv', async (req, reply) => {
    const { current, activity } = await authorizeActivity(req, managerRoles);
    const rows = (
      await db.query(
        'SELECT r.display_name,r.answers,r.created_at,c.checked_in_at FROM registrations r LEFT JOIN checkin_records c ON c.registration_id=r.id WHERE r.activity_id=$1 ORDER BY r.created_at',
        [activity.id],
      )
    ).rows;
    const lines = [
      ['参与者称呼', '补充信息', '报名时间', '签到时间'].map(formulaSafe).join(','),
      ...rows.map((r) =>
        [
          r.display_name,
          JSON.stringify(r.answers),
          new Date(r.created_at).toISOString(),
          r.checked_in_at ? new Date(r.checked_in_at).toISOString() : '',
        ]
          .map(formulaSafe)
          .join(','),
      ),
    ];
    await audit(db, activity.organization_id, current.id, 'registrations.exported', activity.id);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="registrations.csv"')
      .send('\uFEFF' + lines.join('\r\n'));
  });

  async function aiQuota(org: string, actorId: string) {
    await db.mutate('ai_reserve', { organization_id: org, actor_id: actorId });
  }
  app.post(
    '/api/organizations/:orgId/ai/plan',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const current = await user(req);
      const org = idParam(req, 'orgId');
      await membership(current, org, managerRoles);
      const { prompt } = z.object({ prompt: z.string().trim().min(5).max(4000) }).parse(req.body);
      await aiQuota(org, current.id);
      const generated = await generatePlan(prompt);
      const id = randomUUID();
      await db.query(
        'INSERT INTO ai_generation_records(id,organization_id,kind,mode,output,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [id, org, 'plan', generated.mode, JSON.stringify(generated.plan), current.id],
      );
      await audit(db, org, current.id, 'ai.plan_generated', id);
      return { id, ...generated };
    },
  );
  app.get('/api/organizations/:orgId/ai/plans', async (req) => {
    const current = await user(req);
    const org = idParam(req, 'orgId');
    await membership(current, org, managerRoles);
    return (
      await db.query(
        "SELECT id,mode,output AS plan,created_at FROM ai_generation_records WHERE organization_id=$1 AND kind='plan' ORDER BY created_at DESC",
        [org],
      )
    ).rows;
  });
  app.put('/api/organizations/:orgId/ai/plans/:id', async (req) => {
    const current = await user(req);
    const org = idParam(req, 'orgId');
    await membership(current, org, managerRoles);
    const { plan } = z.object({ plan: planSchema }).parse(req.body);
    const result = await db.query(
      "UPDATE ai_generation_records SET output=$1,updated_at=now() WHERE id=$2 AND organization_id=$3 AND kind='plan' RETURNING id,mode,output AS plan",
      [JSON.stringify(plan), idParam(req), org],
    );
    assert(result.rows.length, 404, 'NOT_FOUND', '策划草稿不存在。');
    return result.rows[0];
  });
  app.get('/api/activities/:id/insight', async (req) => {
    const { activity } = await authorizeActivity(req, managerRoles);
    return (
      (
        await db.query(
          "SELECT id,mode,output->>'report' AS report FROM ai_generation_records WHERE activity_id=$1 AND kind='insight' ORDER BY created_at DESC LIMIT 1",
          [activity.id],
        )
      ).rows[0] ?? null
    );
  });
  app.post('/api/activities/:id/insight', async (req) => {
    const { current, activity } = await authorizeActivity(req, managerRoles);
    assert(
      ['Completed', 'Archived'].includes(activity.status),
      409,
      'EVENT_NOT_COMPLETED',
      '请在活动结束后生成复盘。',
    );
    await aiQuota(activity.organization_id, current.id);
    const stats = await analytics(activity);
    const responses = (
      await db.query(
        'SELECT r.answers FROM survey_responses r JOIN surveys s ON s.id=r.survey_id WHERE s.activity_id=$1',
        [activity.id],
      )
    ).rows;
    let mode: 'mock' | 'live' = 'mock';
    let report = `# ${activity.title} 活动复盘\n\n本报告由本地模板根据数据库记录生成。\n\n报名 ${stats.registration_count} 人，签到 ${stats.checkin_count} 人，未签到 ${stats.absent_count} 人，签到率 ${stats.checkin_rate}%。\n\n已收到 ${responses.length} 份反馈。${responses.length ? '反馈内容需进一步人工核实和汇总，不能直接推断整体满意度。' : '缺少参与者反馈，无法判断满意度或学习成果。'}\n\n执行记录不足，无法判断现场流程与活动目标的完成情况。建议负责人补充现场记录，检查未签到原因，并根据实际反馈调整下次安排。`;
    if (process.env.MOCK_AI_MODE === 'false') {
      try {
        report = await liveText(
          `根据以下数据生成中文复盘。不包含个人信息。不要编造满意度或成果。活动：${activity.title}\n统计：${JSON.stringify(stats)}\n反馈份数：${responses.length}\n只提供统计，没有执行记录和反馈文本。请明确数据不足。`,
        );
        mode = 'live';
      } catch {
        report += '\n\n真实 AI 服务暂不可用，已降级为本地模板。';
      }
    }
    const id = randomUUID();
    await db.query(
      'INSERT INTO ai_generation_records(id,organization_id,activity_id,kind,mode,output,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        activity.organization_id,
        activity.id,
        'insight',
        mode,
        JSON.stringify({ report }),
        current.id,
      ],
    );
    return { id, mode, report };
  });
  app.put('/api/activities/:id/insight', async (req) => {
    const { activity } = await authorizeActivity(req, managerRoles);
    const { report } = z.object({ report: z.string().min(1).max(20000) }).parse(req.body);
    const result = await db.query(
      "UPDATE ai_generation_records SET output=$1,updated_at=now() WHERE id=(SELECT id FROM ai_generation_records WHERE activity_id=$2 AND kind='insight' ORDER BY created_at DESC LIMIT 1) RETURNING id,mode,output->>'report' AS report",
      [JSON.stringify({ report }), activity.id],
    );
    assert(result.rows.length, 404, 'NOT_FOUND', '请先生成复盘。');
    return result.rows[0];
  });

  app.get('/api/activities/:id/survey', async (req) => {
    const { activity } = await authorizeActivity(req);
    const survey = (
      await db.query(
        'SELECT s.*,(SELECT count(*)::int FROM survey_responses r WHERE r.survey_id=s.id) AS response_count FROM surveys s WHERE s.activity_id=$1',
        [activity.id],
      )
    ).rows[0];
    assert(survey, 404, 'NOT_FOUND', '该活动尚未创建反馈问卷。');
    return survey;
  });
  app.put('/api/activities/:id/survey', async (req) => {
    const { current, activity } = await authorizeActivity(req, managerRoles);
    const input = z
      .object({
        title: z.string().trim().min(1).max(120),
        questions: z.array(surveyQuestionSchema).min(1).max(20),
      })
      .parse(req.body);
    assert(
      new Set(input.questions.map((q) => q.id)).size === input.questions.length,
      400,
      'DUPLICATE_QUESTION',
      '问题标识不能重复。',
    );
    for (const q of input.questions)
      if (['single', 'multiple'].includes(q.type))
        assert(
          q.options && q.options.length >= 2,
          400,
          'QUESTION_OPTIONS',
          '选择题至少需要两个选项。',
        );
    return db.mutate('survey_save', {
      activity_id: activity.id,
      actor_id: current.id,
      title: input.title,
      questions: input.questions,
    });
  });
  app.get('/api/public/surveys/:id', async (req) => {
    const survey = (
      await db.query(
        "SELECT s.id,s.activity_id,s.title,s.questions FROM surveys s JOIN activities a ON a.id=s.activity_id WHERE s.id=$1 AND a.status NOT IN ('Draft','Cancelled')",
        [idParam(req)],
      )
    ).rows[0];
    assert(survey, 404, 'NOT_FOUND', '问卷不存在或已关闭。');
    return survey;
  });
  app.post(
    '/api/public/surveys/:id/responses',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = z
        .object({
          token: z.string().min(10).max(500),
          answers: z.record(
            z.string(),
            z.union([
              z.string().trim().max(2000),
              z.number().int().min(1).max(5),
              z.array(z.string().max(100)).max(20),
            ]),
          ),
        })
        .parse(req.body);
      const result = await db.mutate<{ id: string; submitted_at: string }>('survey_submit', {
        survey_id: idParam(req),
        token_hash: digest(input.token),
        answers: input.answers,
      });
      reply.code(201);
      return result;
    },
  );
  app.get('/api/activities/:id/survey/results', async (req) => {
    const { activity } = await authorizeActivity(req);
    const survey = (await db.query('SELECT * FROM surveys WHERE activity_id=$1', [activity.id]))
      .rows[0];
    assert(survey, 404, 'NOT_FOUND', '问卷不存在。');
    const rows = (
      await db.query('SELECT answers FROM survey_responses WHERE survey_id=$1', [survey.id])
    ).rows;
    const questions = z.array(surveyQuestionSchema).parse(survey.questions);
    return {
      response_count: rows.length,
      questions: questions.map((q) => {
        const values = rows.map((row) => row.answers[q.id]).filter((v) => v !== undefined);
        if (q.type === 'rating')
          return {
            ...q,
            average: values.length
              ? values.reduce((sum: number, v: number) => sum + v, 0) / values.length
              : null,
          };
        if (q.type === 'text') return { ...q, answer_count: values.length };
        return {
          ...q,
          counts: Object.fromEntries(
            (q.options ?? []).map((option) => [
              option,
              values.filter((v) => (Array.isArray(v) ? v.includes(option) : v === option)).length,
            ]),
          ),
        };
      }),
    };
  });
  return app;
}
