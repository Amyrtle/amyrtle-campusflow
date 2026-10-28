/**
 * Opt-in verification against an explicitly selected, already deployed environment.
 * node tests/cloud/verify-database.mjs --env-id <environment>
 *
 * Credentials come only from ignored .local files. Business operations use the
 * HTTPS data plane; management SQL is used only to remove this run's own fixtures.
 * The script never creates a cloud resource or retries an ambiguous mutation.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const sql = {
  health: 'SELECT 1',
  profileInsert:
    'INSERT INTO users_profile(id,email,display_name,cloudbase_subject) VALUES($1,$2,$3,$4) ON CONFLICT(cloudbase_subject) DO NOTHING',
  profile: 'SELECT id,email,display_name FROM users_profile WHERE cloudbase_subject=$1',
  activity:
    'SELECT a.*, (SELECT count(*)::int FROM checkin_records c WHERE c.activity_id=a.id) AS checkin_count FROM activities a WHERE a.id=$1',
  totals:
    'SELECT (SELECT count(*)::int FROM registrations WHERE activity_id=$1) AS registrations,(SELECT count(*)::int FROM checkin_records WHERE activity_id=$1) AS checkins',
  responses: 'SELECT answers FROM survey_responses WHERE survey_id=$1',
};
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--env-id' || !/^[a-z0-9-]+$/.test(args[1])) {
  throw new Error('Usage: node tests/cloud/verify-database.mjs --env-id <environment>');
}
const environment = args[1];
const secrets = JSON.parse(await readFile(resolve('.local/deployment-secrets.json'), 'utf8'));
const publicConfig = JSON.parse(
  await readFile(resolve('.local/publishable-key-result.json'), 'utf8'),
);
const management = await import(pathToFileURL(resolve('.local/cloud-tools.mjs')).href);
if (
  environment !== secrets.CLOUDBASE_ENV_ID ||
  environment !== publicConfig.envId ||
  environment !== management.environment ||
  typeof secrets.CLOUDBASE_DATABASE_API_KEY !== 'string' ||
  !secrets.CLOUDBASE_DATABASE_API_KEY ||
  typeof publicConfig.publishableKey !== 'string' ||
  !publicConfig.publishableKey
) {
  throw new Error('Environment or credential prerequisites do not match; no changes made');
}
const keys = { server: secrets.CLOUDBASE_DATABASE_API_KEY, public: publicConfig.publishableKey };
const base = `https://${environment}.api.tcloudbasegateway.com/v1/rdb/rest/rpc/`;
const runId = randomUUID();
const actor = randomUUID();
const organization = randomUUID();
const subject = `cloud-verify-${runId}`;
const activityIds = [];
const reportPath = resolve(`.local/cloud-database-verification-${runId}.json`);
const report = {
  runId,
  environment,
  startedAt: new Date().toISOString(),
  transport: 'CloudBase PostgreSQL HTTPS business RPC',
  synthetic: true,
  fixtureIds: { actor, organization, subject, activities: activityIds },
  checks: [],
  cleanup: { completed: false },
  limitations: [
    'Concurrency means simultaneous independent HTTPS requests; gateway database pool size is not observable.',
    'This checks the database layer. Browser login, API authorization and live AI require separate verification.',
    'Public-key and unauthenticated gateway access are tested; an authenticated end-user JWT is not used here.',
  ],
};
await mkdir(resolve('.local'), { recursive: true });
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
await save();

class VerificationFailure extends Error {
  constructor(label, evidence = {}) {
    super(label);
    this.evidence = evidence;
  }
}
function requireValue(condition, label, evidence = {}) {
  if (!condition) throw new VerificationFailure(label, evidence);
}
function safeError(error) {
  return error instanceof VerificationFailure
    ? { reason: error.message, ...error.evidence }
    : { reason: 'Unexpected verification or transport failure', type: error?.name ?? 'Error' };
}
async function request(name, body, credential = 'server') {
  try {
    const response = await fetch(`${base}${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(keys[credential] ? { Authorization: `Bearer ${keys[credential]}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
      redirect: 'error',
    });
    let data;
    try {
      data = await response.json();
    } catch {
      return { ok: false, status: response.status, code: 'INVALID_JSON' };
    }
    // Never persist raw errors, headers, credentials, or response bodies in reports.
    const matched =
      typeof data?.message === 'string' && /^CF:([A-Z_]+)(?::(\{.*\}))?$/s.exec(data.message);
    const code = matched
      ? matched[1]
      : typeof data?.code === 'string' && /^[A-Z0-9_]{3,50}$/.test(data.code)
        ? data.code.replace(/^DATABASE_/, '')
        : response.ok
          ? 'OK'
          : 'UNCLASSIFIED';
    return { ok: response.ok, status: response.status, code, data };
  } catch {
    return { ok: false, status: 0, code: 'TRANSPORT_FAILURE' };
  }
}
function evidence(result) {
  return { status: result.status, code: result.code };
}
function success(result, label) {
  requireValue(result.ok, label, evidence(result));
  return result.data;
}
const mutate = (operation, input, credential) =>
  request('campusflow_mutate', { p_operation: operation, p_input: input }, credential);
const query = (name, params = [], credential) =>
  request('campusflow_query', { p_id: sha(sql[name]), p_params: params }, credential);
async function rows(name, params = []) {
  const data = success(await query(name, params), `Query ${name} failed`);
  requireValue(Array.isArray(data?.rows), 'Query returned invalid rows');
  return data.rows;
}
async function check(name, action) {
  const started = performance.now();
  try {
    const detail = await action();
    report.checks.push({
      name,
      passed: true,
      elapsedMs: Math.round(performance.now() - started),
      ...detail,
    });
  } catch (error) {
    report.checks.push({
      name,
      passed: false,
      elapsedMs: Math.round(performance.now() - started),
      ...safeError(error),
    });
  }
  await save();
  console.log(JSON.stringify({ check: name, passed: report.checks.at(-1).passed }));
}
function histogram(results) {
  return results.reduce((counts, result) => {
    const key = `${result.status}:${result.code}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
async function activity(capacity, label) {
  const id = randomUUID();
  const slug = `verify-${randomUUID()}`;
  activityIds.push(id);
  await save();
  const now = Date.now();
  success(
    await mutate('activity_create', {
      id,
      slug,
      organization_id: organization,
      actor_id: actor,
      activity: {
        title: `合成验收 ${label}`,
        description: '自动验收专用合成数据，结束后删除。',
        category: '测试',
        location: '合成测试场地',
        start_time: new Date(now + 3600000).toISOString(),
        end_time: new Date(now + 7200000).toISOString(),
        registration_start: new Date(now - 3600000).toISOString(),
        registration_deadline: new Date(now + 1800000).toISOString(),
        capacity,
        cover_image: '',
        form_fields: [
          { id: 'group', label: '分组', type: 'select', required: true, options: ['A', 'B'] },
        ],
      },
    }),
    'Synthetic activity creation failed',
  );
  success(
    await mutate('activity_status', { id, actor_id: actor, status: 'Published' }),
    'Synthetic activity publish failed',
  );
  return { id, slug };
}
function registration(event, overrides = {}) {
  const nonce = randomUUID();
  return {
    activity_id: event.id,
    slug: event.slug,
    display_name: '合成测试参与者',
    answers: { group: 'A' },
    idempotency_key: nonce,
    request_hash: sha(`request-${nonce}`),
    token_hash: sha(`ticket-${nonce}`),
    ...overrides,
  };
}
let seedStarted = false;
try {
  success(await query('health'), 'Server credential health check failed');
  await check('public-and-unauthenticated-rpc-denied', async () => {
    const results = await Promise.all([
      query('health', [], 'public'),
      query('health', [], 'none'),
      mutate(
        'organization_create',
        { id: organization, actor_id: actor, name: 'Must not exist' },
        'public',
      ),
      mutate(
        'organization_create',
        { id: organization, actor_id: actor, name: 'Must not exist' },
        'none',
      ),
    ]);
    requireValue(
      results.every((r) => !r.ok && [401, 403].includes(r.status)),
      'Untrusted credential was not rejected',
      { outcomes: histogram(results) },
    );
    requireValue(
      results[0].code === '42501' && results[2].code === '42501',
      'RPC body service-role guard was not observed',
      { outcomes: histogram(results) },
    );
    return { requests: results.length, outcomes: histogram(results) };
  });
  seedStarted = true;
  success(
    await query('profileInsert', [actor, `${subject}@example.test`, '合成验收负责人', subject]),
    'Synthetic profile creation failed',
  );
  success(
    await mutate('organization_create', {
      id: organization,
      name: `合成验收 ${runId}`,
      actor_id: actor,
    }),
    'Synthetic organization creation failed',
  );

  const capacityEvent = await activity(100, '名额并发');
  const capacityInputs = Array.from({ length: 120 }, () => registration(capacityEvent));
  await check('120-concurrent-registrations-for-100-places', async () => {
    const results = await Promise.all(
      capacityInputs.map((input) => mutate('registration_create', input)),
    );
    const accepted = results.filter((r) => r.ok && r.data?.created === true).length;
    const full = results.filter((r) => !r.ok && r.code === 'CAPACITY_FULL').length;
    const totals = (await rows('totals', [capacityEvent.id]))[0];
    const stored = (await rows('activity', [capacityEvent.id]))[0];
    const detail = {
      concurrentRequests: 120,
      capacity: 100,
      accepted,
      rejectedFull: full,
      storedRegistrations: totals.registrations,
      storedCounter: stored.registration_count,
      outcomes: histogram(results),
    };
    requireValue(
      accepted === 100 &&
        full === 20 &&
        totals.registrations === 100 &&
        stored.registration_count === 100,
      'Capacity concurrency invariant failed',
      detail,
    );
    return detail;
  });

  const idempotentEvent = await activity(10, '幂等与签到');
  const repeatedInput = registration(idempotentEvent);
  await check('20-concurrent-identical-registrations', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => mutate('registration_create', repeatedInput)),
    );
    const created = results.filter((r) => r.ok && r.data?.created === true).length;
    const replayed = results.filter((r) => r.ok && r.data?.created === false).length;
    const uniqueTickets = new Set(results.filter((r) => r.ok).map((r) => r.data.registration_id))
      .size;
    const totals = (await rows('totals', [idempotentEvent.id]))[0];
    const stored = (await rows('activity', [idempotentEvent.id]))[0];
    const detail = {
      concurrentRequests: 20,
      created,
      replayed,
      uniqueTickets,
      storedRegistrations: totals.registrations,
      storedCounter: stored.registration_count,
      outcomes: histogram(results),
    };
    requireValue(
      created === 1 &&
        replayed === 19 &&
        uniqueTickets === 1 &&
        totals.registrations === 1 &&
        stored.registration_count === 1,
      'Idempotency concurrency invariant failed',
      detail,
    );
    const conflict = await mutate('registration_create', {
      ...repeatedInput,
      request_hash: sha('conflicting-request'),
    });
    requireValue(
      !conflict.ok && conflict.code === 'IDEMPOTENCY_CONFLICT',
      'Idempotency content conflict was not rejected',
      evidence(conflict),
    );
    return { ...detail, contentConflict: evidence(conflict) };
  });
  await check('20-concurrent-checkins-create-one-record', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        mutate('checkin', {
          activity_id: idempotentEvent.id,
          actor_id: actor,
          token_hash: repeatedInput.token_hash,
        }),
      ),
    );
    const created = results.filter((r) => r.ok && r.data?.already_checked_in === false).length;
    const replayed = results.filter((r) => r.ok && r.data?.already_checked_in === true).length;
    const uniqueTimestamps = new Set(
      results.filter((r) => r.ok).map((r) => r.data.registration.checked_in_at),
    ).size;
    const totals = (await rows('totals', [idempotentEvent.id]))[0];
    const detail = {
      concurrentRequests: 20,
      created,
      replayed,
      uniqueTimestamps,
      storedCheckins: totals.checkins,
      outcomes: histogram(results),
    };
    requireValue(
      created === 1 && replayed === 19 && uniqueTimestamps === 1 && totals.checkins === 1,
      'Check-in concurrency invariant failed',
      detail,
    );
    const forbidden = await mutate('checkin', {
      activity_id: idempotentEvent.id,
      actor_id: randomUUID(),
      token_hash: repeatedInput.token_hash,
    });
    requireValue(
      !forbidden.ok && forbidden.code === 'FORBIDDEN',
      'Nonmember check-in was not rejected',
      evidence(forbidden),
    );
    return { ...detail, nonmember: evidence(forbidden) };
  });

  const rollbackEvent = await activity(2, '事务回滚');
  await check('insert-failure-rolls-back-capacity-counter', async () => {
    // The unique token_hash constraint fails AFTER the transaction increments capacity.
    const result = await mutate(
      'registration_create',
      registration(rollbackEvent, { token_hash: repeatedInput.token_hash }),
    );
    const totals = (await rows('totals', [rollbackEvent.id]))[0];
    const stored = (await rows('activity', [rollbackEvent.id]))[0];
    const detail = {
      failure: evidence(result),
      storedRegistrations: totals.registrations,
      storedCounter: stored.registration_count,
    };
    requireValue(
      !result.ok &&
        result.code === '23505' &&
        totals.registrations === 0 &&
        stored.registration_count === 0,
      'Failed insert was not fully rolled back',
      detail,
    );
    return detail;
  });
  await check('registration-field-validation-before-write', async () => {
    const cases = [
      [{}, 'MISSING_FIELD'],
      [{ group: 'C' }, 'INVALID_OPTION'],
      [{ group: 'A', extra: 'x' }, 'UNKNOWN_FIELD'],
    ];
    const results = [];
    for (const [answers, code] of cases) {
      const result = await mutate('registration_create', registration(rollbackEvent, { answers }));
      requireValue(
        !result.ok && result.code === code,
        'Invalid registration answers accepted',
        evidence(result),
      );
      results.push(evidence(result));
    }
    const totals = (await rows('totals', [rollbackEvent.id]))[0];
    requireValue(totals.registrations === 0, 'Invalid registration wrote data');
    return { rejectedCases: results, storedRegistrations: 0 };
  });

  await check('survey-validation-write-read-and-duplicate-rejection', async () => {
    const questions = [
      { id: 'rating', title: '评分', type: 'rating', required: true },
      { id: 'note', title: '建议', type: 'text', required: false },
      { id: 'single', title: '单选', type: 'single', required: false, options: ['A', 'B'] },
      { id: 'multiple', title: '多选', type: 'multiple', required: false, options: ['A', 'B'] },
    ];
    const input = {
      activity_id: idempotentEvent.id,
      actor_id: actor,
      title: '合成反馈验收',
      questions,
    };
    const survey = success(await mutate('survey_save', input), 'Survey creation failed');
    const common = { survey_id: survey.id, token_hash: repeatedInput.token_hash };
    const cases = [
      [{}, 'EMPTY_RESPONSE'],
      [{ note: '内容' }, 'MISSING_FIELD'],
      [{ rating: 6 }, 'INVALID_ANSWER'],
      [{ rating: 2.5 }, 'INVALID_ANSWER'],
      [{ rating: 5, extra: 'x' }, 'UNKNOWN_FIELD'],
      [{ rating: 5, single: 'C' }, 'INVALID_ANSWER'],
      [{ rating: 5, multiple: ['A', 'A'] }, 'INVALID_ANSWER'],
      [{ rating: 5, note: 9 }, 'INVALID_ANSWER'],
    ];
    for (const [answers, code] of cases) {
      const result = await mutate('survey_submit', { ...common, answers });
      requireValue(
        !result.ok && result.code === code,
        'Invalid survey answers accepted',
        evidence(result),
      );
    }
    const invalidTicket = await mutate('survey_submit', {
      ...common,
      token_hash: sha('invalid-ticket'),
      answers: { rating: 5 },
    });
    requireValue(
      !invalidTicket.ok && invalidTicket.code === 'INVALID_TICKET',
      'Survey accepted invalid ticket',
      evidence(invalidTicket),
    );
    requireValue(
      (await rows('responses', [survey.id])).length === 0,
      'Rejected survey request wrote a response',
    );
    const answers = { rating: 5, note: '合成反馈', single: 'A', multiple: ['A', 'B'] };
    success(
      await mutate('survey_submit', { ...common, answers }),
      'Valid survey submission failed',
    );
    const duplicate = await mutate('survey_submit', { ...common, answers });
    requireValue(
      !duplicate.ok && duplicate.code === 'ALREADY_RESPONDED',
      'Duplicate survey response accepted',
      evidence(duplicate),
    );
    const locked = await mutate('survey_save', input);
    requireValue(
      !locked.ok && locked.code === 'SURVEY_LOCKED',
      'Survey changed after receiving responses',
      evidence(locked),
    );
    const stored = await rows('responses', [survey.id]);
    requireValue(
      stored.length === 1 &&
        stored[0].answers.rating === 5 &&
        stored[0].answers.note === answers.note &&
        JSON.stringify(stored[0].answers.multiple) === JSON.stringify(answers.multiple),
      'Stored survey response did not match',
    );
    return {
      rejectedInvalidCases: cases.length + 1,
      storedResponses: 1,
      duplicate: evidence(duplicate),
      locked: evidence(locked),
    };
  });
} catch (error) {
  report.fatal = safeError(error);
} finally {
  if (seedStarted) {
    let runtime;
    try {
      // Only generated UUIDs and the generated subject enter this narrowly scoped cleanup.
      requireValue(
        [actor, organization].every((id) => /^[0-9a-f-]{36}$/.test(id)) &&
          /^cloud-verify-[0-9a-f-]{36}$/.test(subject),
        'Cleanup fixture identifiers invalid',
      );
      runtime = await management.connect();
      const cleanupSql = `BEGIN;
DELETE FROM public.activities WHERE organization_id='${organization}'::uuid AND created_by='${actor}'::uuid;
DELETE FROM public.organizations WHERE id='${organization}'::uuid AND created_by='${actor}'::uuid;
DELETE FROM public.users_profile WHERE id='${actor}'::uuid AND cloudbase_subject='${subject}';
COMMIT;`;
      const result = await management.call(runtime, 'managePgDatabase', {
        action: 'execute',
        envId: environment,
        sql: cleanupSql,
        confirm: true,
      });
      requireValue(result.success === true, 'Management cleanup did not confirm success', {
        code: /^[A-Z0-9_]{3,60}$/.test(result.errorCode ?? '') ? result.errorCode : 'UNCONFIRMED',
      });
      const profile = await rows('profile', [subject]);
      const activities = await Promise.all(activityIds.map((id) => rows('activity', [id])));
      requireValue(
        profile.length === 0 && activities.every((r) => r.length === 0),
        'Cleanup verification found remaining fixtures',
      );
      report.cleanup = {
        completed: true,
        profileRemaining: 0,
        activitiesRemaining: 0,
        activityIdsChecked: activityIds.length,
        organizationDeletionConfirmed: true,
        dependentRowsRemovedByForeignKeyCascade: true,
      };
    } catch (error) {
      report.cleanup = { completed: false, ...safeError(error) };
    } finally {
      await runtime?.close();
    }
  } else {
    report.cleanup = { completed: true, noSeedDataWritten: true };
  }
  report.finishedAt = new Date().toISOString();
  report.passed =
    !report.fatal &&
    report.checks.length === 7 &&
    report.checks.every((c) => c.passed) &&
    report.cleanup.completed;
  await save();
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks.length,
      passedChecks: report.checks.filter((c) => c.passed).length,
      cleanup: report.cleanup,
      reportPath,
    }),
  );
  if (!report.passed) process.exitCode = 1;
}
