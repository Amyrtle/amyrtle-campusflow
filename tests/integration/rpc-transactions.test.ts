import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
type Json = Record<string, unknown>;

async function rpc(operation: string, input: Json): Promise<Json> {
  return (
    await db.query<{ result: Json }>('SELECT public.campusflow_mutate($1,$2::jsonb) AS result', [
      operation,
      JSON.stringify(input),
    ])
  ).rows[0].result;
}

async function fixture(capacity = 3, publish = true) {
  const actor = randomUUID();
  const organization = randomUUID();
  const activityId = randomUUID();
  const slug = randomUUID();
  await db.query('INSERT INTO users_profile(id,email,display_name) VALUES($1,$2,$3)', [
    actor,
    `${actor}@example.test`,
    'RPC 测试负责人',
  ]);
  await rpc('organization_create', { id: organization, name: 'RPC 测试组织', actor_id: actor });
  const now = Date.now();
  const activity = {
    title: 'RPC 事务测试活动',
    description: '',
    category: '校园活动',
    location: '测试教室',
    start_time: new Date(now + 3600000).toISOString(),
    end_time: new Date(now + 7200000).toISOString(),
    registration_start: new Date(now - 3600000).toISOString(),
    registration_deadline: new Date(now + 1800000).toISOString(),
    capacity,
    cover_image: '',
    form_fields: [
      { id: 'group', label: '分组', type: 'select', required: true, options: ['A', 'B'] },
    ],
  };
  await rpc('activity_create', {
    id: activityId,
    slug,
    organization_id: organization,
    actor_id: actor,
    activity,
  });
  if (publish)
    await rpc('activity_status', { id: activityId, actor_id: actor, status: 'Published' });
  return { actor, organization, activityId, slug, activity };
}

function registration(event: Awaited<ReturnType<typeof fixture>>, overrides: Json = {}) {
  const nonce = randomUUID();
  return {
    activity_id: event.activityId,
    slug: event.slug,
    display_name: '测试参与者',
    answers: { group: 'A' },
    idempotency_key: nonce,
    request_hash: `request-${nonce}`,
    token_hash: `token-${nonce}`,
    ...overrides,
  };
}

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(await readFile(resolve('cloudbase/migrations/20261025000000_schema.sql'), 'utf8'));
  // Test-only auth helper: the real gateway supplies auth.role() from its verified JWT.
  await db.exec(`CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'
    $$;`);
  await db.exec(await readFile(resolve('cloudbase/migrations/20261026000000_rpc.sql'), 'utf8'));
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", ['{"role":"service_role"}']);
}, 30000);

afterAll(async () => {
  await db?.close();
});

describe('shared PostgreSQL business RPC transactions', () => {
  it('rejects absent, anonymous and ordinary user roles inside RPC bodies', async () => {
    try {
      for (const role of [null, 'anon', 'authenticated']) {
        await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
          JSON.stringify(role ? { role } : {}),
        ]);
        await expect(rpc('organization_create', {})).rejects.toMatchObject({ code: '42501' });
        await expect(
          db.query('SELECT campusflow_rpc_assert(true,200,$1,$2)', ['OK', 'ok']),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          db.query("SELECT campusflow_rpc_role(NULL,NULL,ARRAY['Owner'])"),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          db.query("SELECT campusflow_rpc_audit(NULL,NULL,'unauthorized',NULL)"),
        ).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
        '{"role":"service_role"}',
      ]);
    }
    await expect(rpc('execute_sql', { sql: 'SELECT 1' })).rejects.toMatchObject({
      message: 'CF:UNKNOWN_OPERATION',
    });
  });

  it('atomically creates organizations and consumes only matching, unused invitations', async () => {
    const event = await fixture();
    const member = randomUUID();
    const email = `${member}@example.test`;
    await db.query('INSERT INTO users_profile(id,email,display_name) VALUES($1,$2,$3)', [
      member,
      email,
      '受邀测试用户',
    ]);
    const token = randomUUID();
    await db.query(
      "INSERT INTO organization_invitations(id,organization_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,'Staff',$4,now()+interval '1 day')",
      [randomUUID(), event.organization, email, token],
    );
    await expect(
      rpc('organization_join', {
        actor_id: member,
        email: 'wrong@example.test',
        token_hash: token,
      }),
    ).rejects.toMatchObject({ message: 'CF:INVITATION_EMAIL_MISMATCH' });
    expect(await rpc('organization_join', { actor_id: member, email, token_hash: token })).toEqual({
      ok: true,
      organization_id: event.organization,
    });
    await expect(
      rpc('organization_join', { actor_id: member, email, token_hash: token }),
    ).rejects.toMatchObject({ message: 'CF:INVALID_INVITATION' });
    expect(
      (await db.query('SELECT role FROM organization_members WHERE user_id=$1', [member])).rows,
    ).toEqual([{ role: 'Staff' }]);
  });

  it('retains activity states, edit restrictions, field mirrors and deletion rules', async () => {
    const event = await fixture(3, false);
    await expect(
      rpc('activity_status', { id: event.activityId, actor_id: event.actor, status: 'Completed' }),
    ).rejects.toMatchObject({ message: 'CF:INVALID_TRANSITION' });
    const changed = { ...event.activity, title: '已修改的活动', form_fields: [] };
    await rpc('activity_update', {
      id: event.activityId,
      actor_id: event.actor,
      activity: changed,
    });
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM activity_form_fields WHERE activity_id=$1',
          [event.activityId],
        )
      ).rows[0],
    ).toEqual({ count: 0 });
    await rpc('activity_status', {
      id: event.activityId,
      actor_id: event.actor,
      status: 'Published',
    });
    await expect(
      rpc('activity_delete', { id: event.activityId, actor_id: event.actor }),
    ).rejects.toMatchObject({ message: 'CF:DELETE_STATE' });
    await rpc('activity_status', {
      id: event.activityId,
      actor_id: event.actor,
      status: 'Cancelled',
    });
    await expect(
      rpc('activity_update', { id: event.activityId, actor_id: event.actor, activity: changed }),
    ).rejects.toMatchObject({ message: 'CF:ACTIVITY_CHANGED' });
    await rpc('activity_delete', { id: event.activityId, actor_id: event.actor });
    expect(
      (await db.query('SELECT id FROM activities WHERE id=$1', [event.activityId])).rows,
    ).toEqual([]);
  });

  it('enforces registration fields, capacity and stable idempotency before closing checks', async () => {
    const event = await fixture(1);
    await expect(
      rpc('registration_create', registration(event, { answers: {} })),
    ).rejects.toMatchObject({ message: 'CF:MISSING_FIELD' });
    await expect(
      rpc('registration_create', registration(event, { answers: { group: 'C' } })),
    ).rejects.toMatchObject({ message: 'CF:INVALID_OPTION' });
    await expect(
      rpc('registration_create', registration(event, { answers: { group: 'A', extra: 'x' } })),
    ).rejects.toMatchObject({ message: 'CF:UNKNOWN_FIELD' });
    const input = registration(event);
    const first = await rpc('registration_create', input);
    expect(first.created).toBe(true);
    await expect(rpc('registration_create', registration(event))).rejects.toMatchObject({
      message: 'CF:CAPACITY_FULL',
    });
    await rpc('activity_status', {
      id: event.activityId,
      actor_id: event.actor,
      status: 'RegistrationClosed',
    });
    const repeated = await rpc('registration_create', input);
    expect(repeated).toEqual({ ...first, created: false });
    await expect(
      rpc('registration_create', { ...input, request_hash: 'changed' }),
    ).rejects.toMatchObject({ message: 'CF:IDEMPOTENCY_CONFLICT' });
    expect(
      (await db.query('SELECT registration_count FROM activities WHERE id=$1', [event.activityId]))
        .rows[0],
    ).toEqual({ registration_count: 1 });
    expect(first).not.toHaveProperty('token_hash');
    expect(first).not.toHaveProperty('request_hash');
  });

  it('uses database time to reject expired and not-yet-open registrations', async () => {
    const event = await fixture();
    await db.query(
      "UPDATE activities SET registration_start=now()+interval '10 minutes' WHERE id=$1",
      [event.activityId],
    );
    await expect(rpc('registration_create', registration(event))).rejects.toMatchObject({
      message: 'CF:REGISTRATION_CLOSED',
    });
    await db.query(
      "UPDATE activities SET registration_start=now()-interval '1 day',registration_deadline=now()-interval '1 minute' WHERE id=$1",
      [event.activityId],
    );
    await expect(rpc('registration_create', registration(event))).rejects.toMatchObject({
      message: 'CF:REGISTRATION_CLOSED',
    });
    await expect(
      rpc('registration_create', registration(event, { activity_id: randomUUID() })),
    ).rejects.toMatchObject({ message: 'CF:ACTIVITY_CHANGED' });
  });

  it('rechecks roles and staff assignment, preserves duplicate check-in and cascaded deletion', async () => {
    const event = await fixture();
    const input = registration(event);
    const ticket = await rpc('registration_create', input);
    const staff = randomUUID();
    await db.query('INSERT INTO users_profile(id,email,display_name) VALUES($1,$2,$3)', [
      staff,
      `${staff}@example.test`,
      '工作人员',
    ]);
    await db.query(
      "INSERT INTO organization_members(organization_id,user_id,role) VALUES($1,$2,'Staff')",
      [event.organization, staff],
    );
    await expect(
      rpc('checkin', {
        activity_id: event.activityId,
        actor_id: staff,
        token_hash: input.token_hash,
      }),
    ).rejects.toMatchObject({ message: 'CF:FORBIDDEN' });
    await db.query('INSERT INTO activity_staff(activity_id,user_id) VALUES($1,$2)', [
      event.activityId,
      staff,
    ]);
    const checked = await rpc('checkin', {
      activity_id: event.activityId,
      actor_id: staff,
      token_hash: input.token_hash,
    });
    expect(checked.already_checked_in).toBe(false);
    const repeated = await rpc('checkin', {
      activity_id: event.activityId,
      actor_id: staff,
      token_hash: input.token_hash,
    });
    expect(repeated).toEqual({ ...checked, already_checked_in: true });
    await expect(
      rpc('registration_delete', {
        activity_id: event.activityId,
        registration_id: ticket.registration_id,
        actor_id: staff,
      }),
    ).rejects.toMatchObject({ message: 'CF:FORBIDDEN' });
    await rpc('registration_delete', {
      activity_id: event.activityId,
      registration_id: ticket.registration_id,
      actor_id: event.actor,
    });
    expect(
      (
        await db.query('SELECT id FROM checkin_records WHERE registration_id=$1', [
          ticket.registration_id,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (await db.query('SELECT registration_count FROM activities WHERE id=$1', [event.activityId]))
        .rows[0],
    ).toEqual({ registration_count: 0 });
    const second = registration(event);
    await rpc('registration_create', second);
    await rpc('registration_cancel', { slug: event.slug, token_hash: second.token_hash });
    await expect(
      rpc('registration_cancel', { slug: event.slug, token_hash: second.token_hash }),
    ).rejects.toMatchObject({ message: 'CF:NOT_FOUND' });
  });

  it('reserves at most 30 AI generations per organization window', async () => {
    const event = await fixture();
    for (let i = 0; i < 30; i++)
      await rpc('ai_reserve', { organization_id: event.organization, actor_id: event.actor });
    await expect(
      rpc('ai_reserve', { organization_id: event.organization, actor_id: event.actor }),
    ).rejects.toMatchObject({ message: 'CF:AI_LIMIT' });
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM ai_request_logs WHERE organization_id=$1',
          [event.organization],
        )
      ).rows[0],
    ).toEqual({ count: 30 });
  });

  it('validates survey answers and locks questionnaire edits after a successful response', async () => {
    const event = await fixture();
    const input = registration(event);
    await rpc('registration_create', input);
    const questions = [
      { id: 'rate', title: '评分', type: 'rating', required: true },
      { id: 'one', title: '单选', type: 'single', required: false, options: ['A', 'B'] },
      { id: 'many', title: '多选', type: 'multiple', required: false, options: ['A', 'B'] },
      { id: 'text', title: '建议', type: 'text', required: false },
    ];
    const survey = await rpc('survey_save', {
      activity_id: event.activityId,
      actor_id: event.actor,
      title: '反馈',
      questions,
    });
    const response = (answers: Json, token = input.token_hash) =>
      rpc('survey_submit', { survey_id: survey.id, token_hash: token, answers });
    await expect(response({ rate: 5 }, 'invalid')).rejects.toMatchObject({
      message: 'CF:INVALID_TICKET',
    });
    await expect(response({})).rejects.toMatchObject({ message: 'CF:EMPTY_RESPONSE' });
    await expect(response({ rate: 5, unknown: 'x' })).rejects.toMatchObject({
      message: 'CF:UNKNOWN_FIELD',
    });
    await expect(response({ text: '内容' })).rejects.toMatchObject({ message: 'CF:MISSING_FIELD' });
    for (const answers of [
      { rate: 6 },
      { rate: '5' },
      { rate: 2.5 },
      { rate: 5, one: 'C' },
      { rate: 5, many: ['A', 'A'] },
      { rate: 5, text: 3 },
    ]) {
      await expect(response(answers)).rejects.toMatchObject({ message: 'CF:INVALID_ANSWER' });
    }
    const submitted = await response({ rate: 5, one: 'B', many: ['A', 'B'], text: '已完成测试' });
    expect(submitted.id).toBeTruthy();
    await expect(response({ rate: 5 })).rejects.toMatchObject({ message: 'CF:ALREADY_RESPONDED' });
    await expect(
      rpc('survey_save', {
        activity_id: event.activityId,
        actor_id: event.actor,
        title: '修改',
        questions,
      }),
    ).rejects.toMatchObject({ message: 'CF:SURVEY_LOCKED' });
    expect(
      (
        await db.query('SELECT count(*)::int AS count FROM survey_responses WHERE survey_id=$1', [
          survey.id,
        ])
      ).rows[0],
    ).toEqual({ count: 1 });
  });

  it('rolls back both counter and registration if the final audit insert fails', async () => {
    const event = await fixture();
    await db.exec(`CREATE FUNCTION public.test_rpc_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'registration.created' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_rpc_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.test_rpc_audit_failure();`);
    try {
      await expect(rpc('registration_create', registration(event))).rejects.toThrow(
        'test audit failure',
      );
      expect(
        (
          await db.query('SELECT registration_count FROM activities WHERE id=$1', [
            event.activityId,
          ])
        ).rows[0],
      ).toEqual({ registration_count: 0 });
      expect(
        (await db.query('SELECT id FROM registrations WHERE activity_id=$1', [event.activityId]))
          .rows,
      ).toEqual([]);
    } finally {
      await db.exec(
        'DROP TRIGGER test_rpc_audit_failure ON audit_logs; DROP FUNCTION public.test_rpc_audit_failure();',
      );
    }
  });
});
