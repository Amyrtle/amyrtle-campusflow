/**
 * Opt-in cloud browser verification using an existing synthetic QA identity.
 * Usage: node tests/cloud/verify-business.mjs --env-id <environment> --run
 * Never sends email or creates an identity. Cleans only this run's recorded data.
 */
import { chromium, devices, expect as playwrightExpect } from '@playwright/test';
import { build } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

const args = process.argv.slice(2);
const expect = playwrightExpect.configure({ timeout: 30000 });
if (args.length !== 3 || args[0] !== '--env-id' || args[2] !== '--run') {
  throw new Error('Usage: node tests/cloud/verify-business.mjs --env-id <environment> --run');
}
const environment = args[1];
const config = parse(await readFile('.env.production.local'));
const identity = JSON.parse(await readFile('.local/cloud-qa-identity.json', 'utf8'));
const management = await import(pathToFileURL(resolve('.local/cloud-tools.mjs')).href);
const expectedEnv = 'secure-dragon-d6g1dce1lb03f43cf';
if (
  environment !== expectedEnv || environment !== config.VITE_CLOUDBASE_ENV_ID ||
  environment !== management.environment || !identity.result?.Data?.Uid || !identity.password
) throw new Error('Environment and existing synthetic identity must match');
const origin = `https://campusflow-${environment}.webapps.tcloudbase.com`;
const apiOrigin = config.VITE_API_BASE_URL;
if (apiOrigin !== `https://${environment}-1516697172.ap-shanghai.app.tcloudbase.com`) {
  throw new Error('Unexpected API deployment target');
}
const runId = randomUUID();
const orgName = `云端合成验收 ${runId}`;
const title = `合成验收 · 校园创作交流 ${runId.slice(0, 8)}`;
const reportPath = resolve(`.local/cloud-business-verification-${runId}.json`);
const report = {
  runId, environment, startedAt: new Date().toISOString(), synthetic: true,
  fixtureIds: { actor: null, organization: null, activities: [] },
  checks: [], pageErrors: [], apiObservations: [], cleanup: { completed: false },
  limitations: ['Email OTP delivery is not exercised.', 'Mobile viewport is not a real camera test.', 'AI is explicitly in mock mode.'],
};
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const record = async (name, detail = {}) => { report.checks.push({ name, passed: true, ...detail }); await save(); console.log(JSON.stringify({ check: name, passed: true })); };
await save();
const bundle = await build({
  stdin: { contents: "import cloudbase from '@cloudbase/js-sdk'; window.qaAuth = cloudbase.init(window.qaCloudConfig).auth();", resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'silent',
});
const browser = await chromium.launch({ headless: true });
let context;
let mobile;
let currentStage = 'setup';
let token;
async function openPage(page, path) {
  await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
  if (await page.getByText(/^确定访问/).isVisible()) {
    await page.getByText('确定访问', { exact: true }).click({ timeout: 15000 });
    await page.waitForLoadState('networkidle');
  }
}
async function browserApi(page, path, options = {}) {
  return page.evaluate(async ({ url, method, body, credential }) => {
    const response = await fetch(url, {
      method, credentials: 'include',
      headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, ok: response.ok, data };
  }, { url: `${apiOrigin}/api${path}`, method: options.method ?? 'GET', body: options.body, credential: options.auth === false ? null : token });
}
async function noOverflow(page) {
  const { viewport, width } = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, width: document.documentElement.scrollWidth }));
  requireValue(width <= viewport + 1, 'Mobile horizontal overflow');
}
try {
  context = await browser.newContext({ storageState: '.local/cloud-qa-browser-storage.json', viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.pageErrors.push({ scope: 'organizer', name: error.name }));
  page.on('response', async response => {
    if (!response.url().startsWith(`${apiOrigin}/api/`)) return;
    const path = new URL(response.url()).pathname;
    if (response.status() < 400 && !path.endsWith('/insight') && !path.endsWith('/status')) return;
    const timing = response.request().timing();
    const body = await response.json().catch(() => null);
    report.apiObservations.push({ path, method: response.request().method(), status: response.status(), responseStartMs: Math.round(timing.responseStart), error: body?.error ? { code: body.error.code, message: body.error.message } : undefined });
  });
  await openPage(page, '/');
  await page.evaluate(value => { window.qaCloudConfig = value; }, { env: environment, region: config.VITE_CLOUDBASE_REGION, accessKey: config.VITE_PUBLISHABLE_KEY });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  token = await page.evaluate(async ({ username, password }) => {
    let state = await window.qaAuth.getSession();
    if (!state.data?.session || state.error) {
      const login = await window.qaAuth.signInWithPassword({ username, password });
      if (login.error) throw new Error('Synthetic account sign-in failed');
      state = await window.qaAuth.getSession();
    }
    return state.data?.session?.access_token;
  }, { username: identity.username, password: identity.password });
  requireValue(token, 'QA session unavailable');

  currentStage = 'cloud-health-and-cors';
  const health = await browserApi(page, '/health', { auth: false });
  requireValue(health.ok && health.data?.status === 'ok' && health.data.database === 'cloudbase-http' && health.data.auth_mode === 'cloudbase' && health.data.ai_mode === 'mock', 'Unexpected API health or runtime mode');
  await record(currentStage, { status: health.status, database: health.data.database, authMode: health.data.auth_mode, aiMode: health.data.ai_mode });

  currentStage = 'cloud-identity-and-owned-organization';
  const authenticated = await browserApi(page, '/auth/cloudbase', { method: 'POST', body: { access_token: token } });
  requireValue(authenticated.ok && authenticated.data?.user?.id, 'Cloud identity was not accepted by API');
  report.fixtureIds.actor = authenticated.data.user.id;
  await save();
  const organization = await browserApi(page, '/organizations', { method: 'POST', body: { name: orgName } });
  requireValue(organization.status === 201 && organization.data?.id, 'Synthetic organization creation failed');
  report.fixtureIds.organization = organization.data.id;
  await save();
  await page.evaluate(id => localStorage.setItem('campusflow-org', id), organization.data.id);
  await openPage(page, '/app');
  await expect(page.getByRole('heading', { name: /^你好，/ })).toBeVisible();
  await expect(page.getByText('本地开发环境', { exact: true })).toHaveCount(0);
  await record(currentStage);

  currentStage = 'server-authorization';
  const nonmember = await browserApi(page, `/organizations/${randomUUID()}/members`);
  const noIdentity = await browserApi(page, '/auth/session', { auth: false });
  requireValue(nonmember.status === 403 && noIdentity.status === 401, 'Server authorization did not reject unauthorized callers');
  await record(currentStage, { nonmemberStatus: nonmember.status, missingIdentityStatus: noIdentity.status });

  currentStage = 'activity-create-edit-publish';
  await page.getByRole('link', { name: '创建活动', exact: true }).click();
  await page.getByLabel('活动名称', { exact: true }).fill(title);
  await page.getByLabel('活动简介', { exact: true }).fill('自动化云端验收专用合成活动，测试后删除，不是真实活动。');
  await page.getByLabel('活动地点', { exact: true }).fill('合成活动室 101');
  await page.getByLabel(/^活动人数上限/).fill('100');
  await page.getByRole('button', { name: '添加报名问题' }).click();
  await page.getByLabel('问题 1', { exact: true }).fill('你的创作方向');
  await page.getByLabel('必填', { exact: true }).check();
  await page.getByRole('button', { name: '保存活动草稿' }).click();
  await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]{36}$/);
  const activityPath = new URL(page.url()).pathname;
  const activityId = activityPath.split('/').at(-1);
  report.fixtureIds.activities.push(activityId);
  await save();
  await expect(page.getByRole('link', { name: '查看公开页面' })).toHaveCount(0);
  await page.getByRole('link', { name: '编辑活动' }).click();
  await page.getByLabel('活动地点', { exact: true }).fill('合成活动室 202');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page).toHaveURL(new RegExp(`${activityPath}$`));
  await page.getByRole('button', { name: '发布并开放报名' }).click();
  const publicLink = page.getByRole('link', { name: '查看公开页面' });
  await expect(publicLink).toBeVisible();
  const publicPath = await publicLink.getAttribute('href');
  requireValue(/^\/events\//.test(publicPath), 'Public activity route missing');
  await record(currentStage);

  currentStage = 'anonymous-mobile-registration';
  mobile = await browser.newContext({ ...devices['Pixel 7'] });
  const attendee = await mobile.newPage();
  attendee.setDefaultTimeout(20000);
  attendee.on('pageerror', error => report.pageErrors.push({ scope: 'participant', name: error.name }));
  await openPage(attendee, publicPath);
  const denied = await browserApi(attendee, '/auth/session', { auth: false });
  requireValue(denied.status === 401, 'Anonymous protected API was not rejected');
  await expect(attendee.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await attendee.getByLabel('参与者称呼', { exact: true }).fill('合成参与者小林');
  await attendee.getByLabel(/你的创作方向/).fill('合成海报与校园短片');
  await attendee.getByRole('checkbox', { name: /我已阅读/ }).check();
  await noOverflow(attendee);
  await attendee.getByRole('button', { name: '确认报名' }).click();
  await expect(attendee).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect(attendee.getByRole('heading', { name: '报名成功，期待相见。' })).toBeVisible();
  await expect(attendee.getByRole('img', { name: '个人签到二维码' })).toBeVisible();
  await attendee.getByText('查看完整签到码', { exact: true }).click();
  const ticket = await attendee.getByLabel('完整签到码', { exact: true }).inputValue();
  requireValue(/^[A-Za-z0-9_-]{40,}$/.test(ticket), 'Invalid check-in secret');
  await attendee.reload();
  await expect(attendee.getByRole('heading', { name: '报名成功，期待相见。' })).toBeVisible();
  await noOverflow(attendee);
  await record(currentStage, { anonymousProtectedStatus: denied.status });

  currentStage = 'checkin-and-duplicate';
  await page.reload();
  await page.getByRole('button', { name: '开始活动与签到' }).click();
  await page.getByRole('button', { name: '现场签到', exact: true }).click();
  await page.getByLabel('手动输入签到码', { exact: true }).fill(ticket);
  await page.getByRole('button', { name: '核验并签到' }).click();
  await expect(page.getByRole('heading', { name: '签到成功', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('手动输入签到码', { exact: true }).fill(ticket);
  await page.getByRole('button', { name: '核验并签到' }).click();
  await expect(page.getByRole('heading', { name: '已经签到，无需重复' })).toBeVisible();
  await record(currentStage);

  currentStage = 'statistics-and-csv';
  await page.getByRole('button', { name: '数据分析', exact: true }).click();
  await expect(page.locator('.stat').filter({ has: page.getByText('有效报名', { exact: true }) }).locator('strong')).toHaveText('1');
  await expect(page.locator('.stat').filter({ hasText: '实际签到' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.stat').filter({ hasText: '签到率' }).locator('strong')).toHaveText('100.0%');
  await page.getByRole('button', { name: '报名名单', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '导出 CSV' }).or(page.getByRole('button', { name: '导出 CSV' })).click();
  const download = await downloadPromise;
  const csvPath = resolve(`.local/cloud-verification-${runId}.csv`);
  await download.saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  requireValue(csv.includes('参与者称呼') && csv.includes('合成参与者小林') && !csv.includes(ticket), 'CSV content or secret exclusion failed');
  await record(currentStage, { registrations: 1, checkins: 1, checkinRate: 100, csvExcludesTicket: true });

  currentStage = 'survey-and-aggregate';
  await page.getByRole('button', { name: '反馈问卷', exact: true }).click();
  await page.getByRole('button', { name: '保存问卷', exact: true }).click();
  const surveyLink = page.getByRole('link', { name: '打开问卷' });
  await expect(surveyLink).toBeVisible();
  const surveyPath = await surveyLink.getAttribute('href');
  await openPage(attendee, surveyPath);
  await attendee.getByLabel(/^报名签到码/).fill(ticket);
  await attendee.getByRole('group', { name: /这次活动的整体体验如何/ }).getByRole('radio', { name: '5', exact: true }).check();
  await attendee.getByLabel('有什么建议留给下一次活动？', { exact: true }).fill('合成反馈：希望增加交流时间。');
  await attendee.getByRole('button', { name: '提交反馈' }).click();
  await expect(attendee.getByRole('heading', { name: '谢谢你的真诚反馈。' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('已收到 1 份反馈 · 仅展示汇总结果', { exact: true })).toBeVisible();
  await expect(page.locator('.survey-score strong')).toHaveText('5.0');
  const aggregates = await browserApi(page, `/activities/${activityId}/survey/results`);
  requireValue(aggregates.ok && aggregates.data?.response_count === 1 && aggregates.data.questions.some(q => q.type === 'rating' && q.average === 5), 'Survey API aggregate mismatch');
  await record(currentStage, { responses: 1, average: 5 });

  currentStage = 'mock-review-edit-persist';
  await page.getByRole('button', { name: '活动概览', exact: true }).click();
  await page.getByRole('button', { name: '结束活动', exact: true }).click();
  await page.getByRole('button', { name: '活动复盘', exact: true }).click();
  await page.getByRole('button', { name: '生成活动复盘', exact: true }).click();
  await expect(page.getByText('本地模板复盘 · 基于真实统计数据，非真实 AI 模型输出。', { exact: true })).toBeVisible();
  const review = page.getByRole('textbox', { name: '复盘报告（可编辑）', exact: true });
  await expect(review).toHaveValue(/报名 1 人，签到 1 人/);
  const edited = `${await review.inputValue()}\n\n合成验收补充：已人工审核。`;
  await review.fill(edited);
  await page.getByRole('button', { name: '保存报告', exact: true }).click();
  await expect(page.getByText('复盘报告已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '复盘报告（可编辑）', exact: true })).toHaveValue(edited);
  await record(currentStage, { mockLabelVisible: true });

  currentStage = 'participant-erasure';
  await openPage(page, `${activityPath}?tab=registrations`);
  const row = page.getByRole('row').filter({ hasText: '合成参与者小林' });
  page.once('dialog', dialog => void dialog.dismiss());
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await expect(row).toBeVisible();
  page.once('dialog', dialog => void dialog.accept());
  await row.getByRole('button', { name: '删除', exact: true }).click();
  await expect(row).toHaveCount(0);
  await record(currentStage);
  requireValue(report.pageErrors.length === 0, 'Browser page errors detected');
} catch (error) {
  // No raw errors or responses: they can contain tokens, request bodies or participant data.
  const safeMessage = String(error?.message ?? '').replace(/[A-Za-z0-9_-]{40,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '[redacted]').slice(0,2000);
  report.failure = { stage: currentStage, type: error?.name ?? 'Error', message: safeMessage };
  console.log(JSON.stringify({ failedStage: currentStage, type: error?.name ?? 'Error' }));
} finally {
  await mobile?.close();
  await context?.close();
  await browser.close();
  const { actor, organization } = report.fixtureIds;
  if (organization && actor) {
    let runtime;
    try {
      requireValue([actor, organization, ...report.fixtureIds.activities].every(value => /^[0-9a-f-]{36}$/.test(value)), 'Invalid fixture identifiers');
      runtime = await management.connect();
      const cleanupSql = `BEGIN;
DELETE FROM public.activities WHERE organization_id='${organization}'::uuid AND created_by='${actor}'::uuid;
DELETE FROM public.organizations WHERE id='${organization}'::uuid AND created_by='${actor}'::uuid AND name='${orgName}';
COMMIT;`;
      const result = await management.call(runtime, 'managePgDatabase', { action: 'execute', envId: environment, sql: cleanupSql, confirm: true });
      requireValue(result.success === true, 'Fixture cleanup not confirmed');
      const verify = await management.call(runtime, 'queryPgDatabase', { action: 'sql', sql: `SELECT (SELECT count(*) FROM public.organizations WHERE id='${organization}'::uuid)::int AS organizations,(SELECT count(*) FROM public.activities WHERE organization_id='${organization}'::uuid)::int AS activities` });
      await writeFile(resolve(`.local/cloud-business-cleanup-${runId}.json`), JSON.stringify(verify, null, 2), { mode: 0o600 });
      requireValue(verify.success === true && Number(verify.data?.rows?.[0]?.organizations) === 0 && Number(verify.data?.rows?.[0]?.activities) === 0, 'Fixture rows remain after cleanup');
      report.cleanup = { completed: true, organizationDeleted: true, activityDeletionScopedToOrganizationAndActor: true, dependentRowsRemovedByCascade: true, qaIdentityAndProfileRetained: true, verificationSaved: true };
    } catch (error) {
      report.cleanup = { completed: false, type: error?.name ?? 'Error' };
    } finally { await runtime?.close(); }
  } else report.cleanup = { completed: !organization, noOrganizationCreated: !organization, qaProfileMayExist: !!actor };
  report.finishedAt = new Date().toISOString();
  report.passed = !report.failure && report.checks.length === 10 && report.cleanup.completed;
  report.qaSubjectFingerprint = createHash('sha256').update(identity.result.Data.Uid).digest('hex').slice(0, 12);
  await save();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, cleanup: report.cleanup, reportPath }));
  if (!report.passed) process.exitCode = 1;
}
