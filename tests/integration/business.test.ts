import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../services/api/src/app';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import type { ActivityInput, Session, Ticket } from '@campusflow/shared';

let app: FastifyInstance;
let ownerCookie: string;
let owner: Session;
let outsiderCookie: string;
let outsider: Session;
let activityId: string;
let slug: string;
let firstTicket: Ticket;
const activity = (overrides: Partial<ActivityInput> = {}): ActivityInput => ({
  title: '并发报名验证活动',
  description: '完全虚构的自动化测试活动',
  category: '科创',
  location: '测试教室',
  start_time: new Date(Date.now() + 3600000).toISOString(),
  end_time: new Date(Date.now() + 7200000).toISOString(),
  registration_start: new Date(Date.now() - 3600000).toISOString(),
  registration_deadline: new Date(Date.now() + 1800000).toISOString(),
  capacity: 100,
  cover_image: '',
  form_fields: [],
  ...overrides,
});
const request = (method: HTTPMethods, url: string, payload?: unknown, cookie?: string) =>
  app.inject({
    method,
    url: `/api${url}`,
    payload: payload as Record<string, unknown> | undefined,
    headers: { ...(cookie ? { cookie } : {}), origin: 'http://localhost:5173' },
  });
const cookieFrom = (response: { headers: Record<string, unknown> }) => {
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies])
    .map((value) => String(value).split(';')[0])
    .join('; ');
};

beforeAll(async () => {
  process.env.AUTH_MODE = 'local';
  process.env.MOCK_AI_MODE = 'true';
  process.env.APP_ORIGIN = 'http://localhost:5173';
  app = await createApp({ dataDir: 'memory://', logger: false });
  await app.ready();
  const one = await request('POST', '/auth/register', {
    email: 'owner@example.test',
    password: 'testing-pass-123',
    display_name: '测试负责人',
    organization_name: '测试组织甲',
  });
  expect(one.statusCode, one.body).toBeLessThan(300);
  ownerCookie = cookieFrom(one);
  owner = one.json();
  const two = await request('POST', '/auth/register', {
    email: 'other@example.test',
    password: 'testing-pass-456',
    display_name: '另一组织负责人',
    organization_name: '测试组织乙',
  });
  expect(two.statusCode, two.body).toBeLessThan(300);
  outsiderCookie = cookieFrom(two);
  outsider = two.json();
});
afterAll(async () => {
  await app?.close();
});

describe('真实持久层上的组织、报名、签到和复盘闭环', () => {
  it('注册登录建立真实会话，密码错误不能登录', async () => {
    expect(owner.organizations[0].role).toBe('Owner');
    const session = await request('GET', '/auth/session', undefined, ownerCookie);
    expect(session.statusCode).toBe(200);
    expect(session.json().user.email).toBe('owner@example.test');
    expect(
      (
        await request('POST', '/auth/login', {
          email: 'owner@example.test',
          password: 'incorrect-pass-123',
        })
      ).statusCode,
    ).toBe(401);
  });
  it('未登录不能读取工作台', async () => {
    expect(
      (await request('GET', `/organizations/${owner.organizations[0].id}/activities`)).statusCode,
    ).toBe(401);
  });
  it('创建活动并禁止非法状态跳转', async () => {
    const result = await request(
      'POST',
      `/organizations/${owner.organizations[0].id}/activities`,
      activity(),
      ownerCookie,
    );
    expect(result.statusCode, result.body).toBeLessThan(300);
    const event = result.json();
    activityId = event.id;
    slug = event.slug;
    expect(event.status).toBe('Draft');
    expect(
      (
        await request(
          'POST',
          `/activities/${activityId}/status`,
          { status: 'Completed' },
          ownerCookie,
        )
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await request(
          'POST',
          `/activities/${activityId}/status`,
          { status: 'Published' },
          ownerCookie,
        )
      ).statusCode,
    ).toBeLessThan(300);
    expect((await request('GET', `/public/events/${slug}`)).json().title).toBe('并发报名验证活动');
  });
  it('跨组织读取、修改和导出被拒绝', async () => {
    for (const suffix of ['', '/registrations', '/analytics', '/export.csv']) {
      expect(
        (await request('GET', `/activities/${activityId}${suffix}`, undefined, outsiderCookie))
          .statusCode,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(
      (
        await request(
          'PATCH',
          `/activities/${activityId}`,
          activity({ title: '越权修改' }),
          outsiderCookie,
        )
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(outsider.organizations[0].id).not.toBe(owner.organizations[0].id);
  });
  it('120个并发报名最多接受100人，重复请求不重复写入', async () => {
    const bodies = Array.from({ length: 120 }, (_, i) => ({
      display_name: i === 0 ? '=HYPERLINK("https://example.test")' : `虚构参与者${i}`,
      answers: {},
      consent: true,
      idempotency_key: randomUUID(),
    }));
    const responses = await Promise.all(
      bodies.map((body) => request('POST', `/public/events/${slug}/register`, body)),
    );
    const accepted = responses.filter((r) => r.statusCode < 300);
    expect(accepted).toHaveLength(100);
    expect(responses.filter((r) => r.statusCode >= 400)).toHaveLength(20);
    const firstIndex = responses.findIndex((r) => r.statusCode < 300);
    firstTicket = responses[firstIndex].json();
    expect(firstTicket.token.length).toBeGreaterThanOrEqual(32);
    expect(firstTicket.token).not.toContain(bodies[firstIndex].display_name);
    const retry = await request('POST', `/public/events/${slug}/register`, bodies[firstIndex]);
    expect(retry.statusCode, retry.body).toBeLessThan(300);
    expect(retry.json().token).toBe(firstTicket.token);
    const changed = await request('POST', `/public/events/${slug}/register`, {
      ...bodies[firstIndex],
      display_name: '篡改重试',
    });
    expect(changed.statusCode).toBe(409);
    const analytics = (
      await request('GET', `/activities/${activityId}/analytics`, undefined, ownerCookie)
    ).json();
    expect(analytics.registration_count).toBe(100);
    expect(analytics.remaining).toBe(0);
  });
  it('签到验证权限、无效凭证与重复扫码幂等', async () => {
    expect(
      (await request('POST', `/activities/${activityId}/checkin`, { token: firstTicket.token }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await request(
          'POST',
          `/activities/${activityId}/checkin`,
          { token: 'invalid-token-000000000000000000000' },
          ownerCookie,
        )
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    await request(
      'POST',
      `/activities/${activityId}/status`,
      { status: 'InProgress' },
      ownerCookie,
    );
    const checks = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(
          'POST',
          `/activities/${activityId}/checkin`,
          { token: firstTicket.token },
          ownerCookie,
        ),
      ),
    );
    expect(
      checks.every((r) => r.statusCode < 300),
      checks.map((r) => r.body).join('\n'),
    ).toBe(true);
    expect(checks.filter((r) => r.json().already_checked_in === false)).toHaveLength(1);
    const analytics = (
      await request('GET', `/activities/${activityId}/analytics`, undefined, ownerCookie)
    ).json();
    expect(analytics.checkin_count).toBe(1);
    expect(analytics.checkin_rate).toBe(1);
    expect(analytics.absent_count).toBe(99);
  });
  it('公开页面和报名接口不泄露参与者名单或密钥摘要', async () => {
    const publicEvent = await request('GET', `/public/events/${slug}`);
    expect(publicEvent.body).not.toContain('owner@example.test');
    expect(publicEvent.body).not.toContain('token_hash');
    expect((await request('GET', `/activities/${activityId}/registrations`)).statusCode).toBe(401);
  });
  it('CSV 导出使用真实数据并转义公式注入', async () => {
    const csv = await request(
      'GET',
      `/activities/${activityId}/export.csv`,
      undefined,
      ownerCookie,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain("'=HYPERLINK");
  });
  it('截止和取消活动不再接受报名', async () => {
    for (const cancelled of [false, true]) {
      const result = await request(
        'POST',
        `/organizations/${owner.organizations[0].id}/activities`,
        activity({
          title: cancelled ? '取消测试' : '截止测试',
          registration_deadline: new Date(Date.now() - 1000).toISOString(),
        }),
        ownerCookie,
      );
      expect(result.statusCode, result.body).toBeLessThan(300);
      const event = result.json();
      await request(
        'POST',
        `/activities/${event.id}/status`,
        { status: cancelled ? 'Cancelled' : 'Published' },
        ownerCookie,
      );
      const reg = await request('POST', `/public/events/${event.slug}/register`, {
        display_name: '迟到申请',
        consent: true,
        answers: {},
        idempotency_key: randomUUID(),
      });
      expect(reg.statusCode).toBeGreaterThanOrEqual(400);
    }
  });
  it('无效时间与缺少同意的表单被拒绝', async () => {
    const invalid = await request(
      'POST',
      `/organizations/${owner.organizations[0].id}/activities`,
      activity({ end_time: new Date(Date.now() - 1).toISOString() }),
      ownerCookie,
    );
    expect(invalid.statusCode).toBe(400);
    expect(
      (
        await request('POST', `/public/events/${slug}/register`, {
          display_name: '',
          answers: {},
          idempotency_key: randomUUID(),
        })
      ).statusCode,
    ).toBe(400);
  });
  it('不能发布无法填写的单选报名问题或覆盖系统字段', async () => {
    for (const field of [
      { id: 'track', label: '方向', type: 'select' as const, required: true, options: [] },
      { id: 'consent', label: '备注', type: 'text' as const, required: false },
    ]) {
      const response = await request(
        'POST',
        `/organizations/${owner.organizations[0].id}/activities`,
        activity({ form_fields: [field] }),
        ownerCookie,
      );
      expect(response.statusCode, response.body).toBe(400);
    }
  });
  it('AI 模板降级有标识，输出可校验和保存且不自动发布', async () => {
    const generated = await request(
      'POST',
      `/organizations/${owner.organizations[0].id}/ai/plan`,
      { prompt: '为100名大学生策划AIGC创作交流，持续两小时，预算和地点待定。' },
      ownerCookie,
    );
    expect(generated.statusCode, generated.body).toBeLessThan(300);
    const body = generated.json();
    expect(body.mode).toBe('mock');
    expect(body.plan.missing_information.length).toBeGreaterThan(0);
    const saved = await request(
      'PUT',
      `/organizations/${owner.organizations[0].id}/ai/plans/${body.id}`,
      { plan: { ...body.plan, event_title: '人工确认的活动标题' } },
      ownerCookie,
    );
    expect(saved.statusCode, saved.body).toBeLessThan(300);
  });
  it('真实 AI 不可用时返回明确的降级提示', async () => {
    process.env.MOCK_AI_MODE = 'false';
    try {
      const response = await request(
        'POST',
        `/organizations/${owner.organizations[0].id}/ai/plan`,
        { prompt: '策划一次公开的校园读书交流活动，具体时间和地点待确认。' },
        ownerCookie,
      );
      expect(response.statusCode, response.body).toBeLessThan(300);
      expect(response.json().mode).toBe('mock');
      expect(response.json().warning).toMatch(/失败|模板/);
    } finally {
      process.env.MOCK_AI_MODE = 'true';
    }
  });
  it('Viewer 可看统计但不能读取名单或修改活动', async () => {
    const registered = await request('POST', '/auth/register', {
      email: 'viewer@example.test',
      password: 'viewer-pass-123',
      display_name: '测试观察员',
    });
    const viewerCookie = cookieFrom(registered);
    const invite = await request(
      'POST',
      `/organizations/${owner.organizations[0].id}/members`,
      { email: 'viewer@example.test', role: 'Viewer' },
      ownerCookie,
    );
    expect(invite.statusCode, invite.body).toBeLessThan(300);
    const joined = await request(
      'POST',
      '/organizations/join',
      { token: invite.json().token },
      viewerCookie,
    );
    expect(joined.statusCode, joined.body).toBeLessThan(300);
    expect(
      (await request('GET', `/activities/${activityId}/analytics`, undefined, viewerCookie))
        .statusCode,
    ).toBe(200);
    expect(
      (await request('GET', `/activities/${activityId}/registrations`, undefined, viewerCookie))
        .statusCode,
    ).toBe(403);
    expect(
      (await request('PATCH', `/activities/${activityId}`, activity(), viewerCookie)).statusCode,
    ).toBe(403);
  });
  it('Staff 未分配活动不能签到，分配后可验票', async () => {
    const registered = await request('POST', '/auth/register', {
      email: 'staff@example.test',
      password: 'staff-pass-123',
      display_name: '测试工作人员',
    });
    const staffCookie = cookieFrom(registered);
    const staffId = registered.json().user.id;
    const invite = await request(
      'POST',
      `/organizations/${owner.organizations[0].id}/members`,
      { email: 'staff@example.test', role: 'Staff' },
      ownerCookie,
    );
    await request('POST', '/organizations/join', { token: invite.json().token }, staffCookie);
    expect(
      (
        await request(
          'POST',
          `/activities/${activityId}/checkin`,
          { token: firstTicket.token },
          staffCookie,
        )
      ).statusCode,
    ).toBe(403);
    const assigned = await request(
      'POST',
      `/activities/${activityId}/staff`,
      { user_id: staffId },
      ownerCookie,
    );
    expect(assigned.statusCode, assigned.body).toBeLessThan(300);
    const check = await request(
      'POST',
      `/activities/${activityId}/checkin`,
      { token: firstTicket.token },
      staffCookie,
    );
    expect(check.statusCode, check.body).toBe(200);
    expect(check.json().already_checked_in).toBe(true);
    expect(
      (
        await request(
          'POST',
          `/activities/${activityId}/status`,
          { status: 'Completed' },
          staffCookie,
        )
      ).statusCode,
    ).toBe(403);
  });
  it('问卷仅接受有效报名凭证且防止重复提交', async () => {
    const configured = await request(
      'PUT',
      `/activities/${activityId}/survey`,
      {
        title: '活动体验反馈',
        questions: [
          { id: 'rating', title: '体验评分', type: 'rating', required: true },
          { id: 'suggestion', title: '建议', type: 'text', required: false },
        ],
      },
      ownerCookie,
    );
    expect(configured.statusCode, configured.body).toBeLessThan(300);
    const surveyId = configured.json().id;
    const invalid = await request('POST', `/public/surveys/${surveyId}/responses`, {
      token: 'not-a-valid-ticket',
      answers: { rating: 5 },
    });
    expect(invalid.statusCode).toBeGreaterThanOrEqual(400);
    const payload = {
      token: firstTicket.token,
      answers: { rating: 4, suggestion: '希望增加交流时间' },
    };
    const saved = await request('POST', `/public/surveys/${surveyId}/responses`, payload);
    expect(saved.statusCode, saved.body).toBeLessThan(300);
    expect(
      (await request('POST', `/public/surveys/${surveyId}/responses`, payload)).statusCode,
    ).toBe(409);
  });
  it('零报名活动统计不会除零', async () => {
    const created = (
      await request(
        'POST',
        `/organizations/${owner.organizations[0].id}/activities`,
        activity({ title: '空活动统计' }),
        ownerCookie,
      )
    ).json();
    const stats = (
      await request('GET', `/activities/${created.id}/analytics`, undefined, ownerCookie)
    ).json();
    expect(stats.registration_count).toBe(0);
    expect(stats.checkin_rate).toBe(0);
  });
  it('活动复盘基于真实报名签到，并说明反馈不足', async () => {
    await request('POST', `/activities/${activityId}/status`, { status: 'Completed' }, ownerCookie);
    const review = await request('POST', `/activities/${activityId}/insight`, {}, ownerCookie);
    expect(review.statusCode, review.body).toBeLessThan(300);
    expect(review.json().report).toContain('100');
    expect(review.json().report).toContain('1');
    expect(review.json().report).toMatch(/不足|缺少|没有|尚未/);
  });
  it('跨站写入请求被拒绝', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/organizations`,
      headers: { cookie: ownerCookie, origin: 'https://attacker.invalid' },
      payload: { name: '非法来源组织' },
    });
    expect(response.statusCode).toBe(403);
  });
  it('分离部署的可信前端可预检，未知来源不获得 CORS 授权', async () => {
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/organizations',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-headers']).toMatch(/authorization/i);
    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/organizations',
      headers: { origin: 'https://attacker.invalid', 'access-control-request-method': 'POST' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('网关管理 CORS 时不重复响应头，仍验证来源和预检请求头', async () => {
    const previous = process.env.CORS_MANAGED_BY_GATEWAY;
    let gatewayApp: FastifyInstance | undefined;
    try {
      process.env.CORS_MANAGED_BY_GATEWAY = 'true';
      gatewayApp = await createApp({ dataDir: 'memory://', logger: false });
      const allowed = await gatewayApp.inject({
        method: 'OPTIONS',
        url: '/api/organizations',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(allowed.statusCode).toBe(204);
      expect(allowed.headers.vary).toBe('Origin');
      expect(Object.keys(allowed.headers).some((name) => name.startsWith('access-control-'))).toBe(false);
      const unauthenticated = await gatewayApp.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(unauthenticated.statusCode).toBe(401);
      expect(unauthenticated.headers['access-control-allow-origin']).toBeUndefined();
      const denied = await gatewayApp.inject({
        method: 'POST',
        url: '/api/organizations',
        headers: { origin: 'https://attacker.invalid' },
        payload: { name: '非法来源组织' },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('ORIGIN_FORBIDDEN');
      const invalidHeaders = await gatewayApp.inject({
        method: 'OPTIONS',
        url: '/api/organizations',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'x-untrusted-header',
        },
      });
      expect(invalidHeaders.statusCode).toBe(400);
      expect(invalidHeaders.json().error.code).toBe('CORS_HEADERS');
    } finally {
      await gatewayApp?.close();
      if (previous === undefined) delete process.env.CORS_MANAGED_BY_GATEWAY;
      else process.env.CORS_MANAGED_BY_GATEWAY = previous;
    }
  });
});
