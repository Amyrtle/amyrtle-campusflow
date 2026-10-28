import { test, expect, devices, type Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const screenshots = resolve('docs/screenshots');
const baseURL = 'http://127.0.0.1:5173';

test.beforeEach(async ({ request }) => {
  // Refuse to create fixtures against a cloud or live-AI environment.
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  expect(await health.json()).toMatchObject({
    status: 'ok',
    database: 'pglite',
    auth_mode: 'local',
    ai_mode: 'mock',
  });
});

async function registerWorkspace(page: Page) {
  const key = randomUUID().slice(0, 8);
  await page.goto('/register');
  await page.getByLabel('你的称呼', { exact: true }).fill('示例组织者');
  await page.getByLabel('邮箱', { exact: true }).fill(`campusflow-${key}@example.test`);
  await page.getByLabel(/^密码/).fill(`TestOnly-${key}-2026!`);
  await page.getByLabel('组织名称', { exact: true }).fill(`示例校园创意工坊 ${key}`);
  await page.getByRole('button', { name: '创建账号与组织' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: '你好，示例组织者。' })).toBeVisible();
  await expect(page.getByText('本地开发环境', { exact: true })).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(
    sizes.content,
    `Content width ${sizes.content}px exceeds viewport ${sizes.viewport}px`,
  ).toBeLessThanOrEqual(sizes.viewport + 1);
}

async function screenshot(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: resolve(screenshots, name),
    fullPage: true,
    animations: 'disabled',
  });
}

test('组织者创建发布，匿名手机报名，签到反馈复盘形成闭环', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await registerWorkspace(page);

  await page.getByRole('link', { name: '创建活动', exact: true }).click();
  await page.getByLabel('活动名称', { exact: true }).fill('示例 · 校园 AIGC 创作交流会');
  await page
    .getByLabel('活动简介', { exact: true })
    .fill('自动化验收使用的虚构示例活动：一起探索创意，交流 AI 作品。本场不代表真实校园组织活动。');
  await page.getByLabel('活动地点', { exact: true }).fill('示例活动室 101');
  await page.getByLabel(/^活动人数上限/).fill('100');
  await page.getByRole('button', { name: '添加报名问题' }).click();
  await page.getByLabel('问题 1', { exact: true }).fill('你的创作方向');
  await page.getByLabel('必填', { exact: true }).check();
  await page.getByRole('button', { name: '保存活动草稿' }).click();
  await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]{36}$/);
  const activityPath = new URL(page.url()).pathname;
  await expect(
    page.getByRole('heading', { name: '示例 · 校园 AIGC 创作交流会', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '查看公开页面' })).toHaveCount(0);

  await page.getByRole('link', { name: '编辑活动' }).click();
  await page.getByLabel('活动地点', { exact: true }).fill('示例活动室 202（测试数据）');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page).toHaveURL(new RegExp(`${activityPath}$`));
  await page.getByRole('button', { name: '发布并开放报名' }).click();
  const publicLink = page.getByRole('link', { name: '查看公开页面' });
  await expect(publicLink).toBeVisible();
  const publicPath = await publicLink.getAttribute('href');
  expect(publicPath).toMatch(/^\/events\//);

  const mobile = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  try {
    const attendee = await mobile.newPage();
    const anonSession = await mobile.request.get('/api/auth/session');
    expect(anonSession.status()).toBe(401);
    await attendee.goto(publicPath!);
    await expect(
      attendee.getByRole('heading', { name: '示例 · 校园 AIGC 创作交流会', exact: true }),
    ).toBeVisible();
    await expect(attendee.getByText('示例活动室 202（测试数据）', { exact: true })).toBeVisible();
    await attendee.getByLabel('参与者称呼', { exact: true }).fill('示例参与者小林');
    await attendee.getByLabel(/你的创作方向/).fill('海报设计与校园短片');
    await attendee.getByRole('checkbox', { name: /我已阅读/ }).check();
    await noHorizontalOverflow(attendee);
    await screenshot(attendee, 'mobile-registration.png');
    await attendee.getByRole('button', { name: '确认报名' }).click();
    await expect(attendee).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
    await expect(attendee.getByRole('heading', { name: '报名成功，期待相见。' })).toBeVisible();
    await expect(attendee.getByRole('img', { name: '个人签到二维码' })).toBeVisible();
    await attendee.getByText('查看完整签到码', { exact: true }).click();
    const ticket = await attendee.getByLabel('完整签到码', { exact: true }).inputValue();
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(ticket).not.toContain('小林');
    await noHorizontalOverflow(attendee);
    await attendee.reload();
    await expect(attendee.getByRole('heading', { name: '报名成功，期待相见。' })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: '开始活动与签到' }).click();
    await expect(page.getByText('进行中', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '现场签到', exact: true }).click();
    await page.getByLabel('手动输入签到码', { exact: true }).fill(ticket);
    await page.getByRole('button', { name: '核验并签到' }).click();
    await expect(page.getByRole('heading', { name: '签到成功', exact: true })).toBeVisible();
    await expect(page.locator('.checkin-result')).toContainText('示例参与者小林');

    // A fresh scanner view must preserve idempotence across reloads as well.
    await page.reload();
    await page.getByLabel('手动输入签到码', { exact: true }).fill(ticket);
    await page.getByRole('button', { name: '核验并签到' }).click();
    await expect(page.getByRole('heading', { name: '已经签到，无需重复' })).toBeVisible();

    await page.getByRole('button', { name: '数据分析', exact: true }).click();
    await expect(
      page
        .locator('.stat')
        .filter({ has: page.getByText('有效报名', { exact: true }) })
        .locator('strong'),
    ).toHaveText('1');
    await expect(
      page.locator('.stat').filter({ hasText: '实际签到' }).locator('strong'),
    ).toHaveText('1');
    await expect(page.locator('.stat').filter({ hasText: '未签到' }).locator('strong')).toHaveText(
      '0',
    );
    await expect(page.locator('.stat').filter({ hasText: '签到率' }).locator('strong')).toHaveText(
      '100.0%',
    );

    await page.getByRole('button', { name: '报名名单', exact: true }).click();
    const attendeeRow = page.getByRole('row').filter({ hasText: '示例参与者小林' });
    await expect(attendeeRow).toContainText('海报设计与校园短片');
    await expect(attendeeRow).toContainText('已签到');
    const downloadPromise = page.waitForEvent('download');
    await page
      .getByRole('link', { name: '导出 CSV' })
      .or(page.getByRole('button', { name: '导出 CSV' }))
      .click();
    const download = await downloadPromise;
    const csvPath = testInfo.outputPath('registrations.csv');
    await download.saveAs(csvPath);
    const csv = await readFile(csvPath, 'utf8');
    expect(csv).toContain('参与者称呼');
    expect(csv).toContain('示例参与者小林');
    expect(csv).not.toContain(ticket);

    await page.getByRole('button', { name: '反馈问卷', exact: true }).click();
    await page.getByRole('button', { name: '保存问卷', exact: true }).click();
    const surveyLink = page.getByRole('link', { name: '打开问卷' });
    await expect(surveyLink).toBeVisible();
    const surveyPath = await surveyLink.getAttribute('href');
    expect(surveyPath).toMatch(/^\/surveys\//);
    await attendee.goto(surveyPath!);
    await attendee.getByLabel(/^报名签到码/).fill(ticket);
    await attendee
      .getByRole('group', { name: /这次活动的整体体验如何/ })
      .getByRole('radio', { name: '5', exact: true })
      .check();
    await attendee
      .getByLabel('有什么建议留给下一次活动？', { exact: true })
      .fill('示例反馈：希望增加作品交流时间。');
    await attendee.getByRole('button', { name: '提交反馈' }).click();
    await expect(attendee.getByRole('heading', { name: '谢谢你的真诚反馈。' })).toBeVisible();
    await noHorizontalOverflow(attendee);
    await page.reload();
    await expect(page.getByText('已收到 1 份反馈 · 仅展示汇总结果', { exact: true })).toBeVisible();
    await expect(page.locator('.survey-score strong')).toHaveText('5.0');
    const surveyResult = await page.request.get(
      `/api${activityPath.replace('/app/events/', '/activities/')}/survey/results`,
    );
    expect(surveyResult.ok()).toBeTruthy();
    const aggregate = (await surveyResult.json()) as {
      response_count: number;
      questions: { type: string; average?: number }[];
    };
    expect(aggregate.response_count).toBe(1);
    expect(aggregate.questions.find((question) => question.type === 'rating')?.average).toBe(5);

    await page.getByRole('button', { name: '活动概览', exact: true }).click();
    await page.getByRole('button', { name: '结束活动', exact: true }).click();
    await expect(page.getByText('已结束', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '活动复盘', exact: true }).click();
    await page.getByRole('button', { name: '生成活动复盘', exact: true }).click();
    await expect(
      page.getByText('本地模板复盘 · 基于真实统计数据，非真实 AI 模型输出。', { exact: true }),
    ).toBeVisible();
    const report = page.getByRole('textbox', { name: '复盘报告（可编辑）', exact: true });
    await expect(report).toHaveValue(/报名 1 人，签到 1 人/);
    await expect(report).toHaveValue(/已收到 1 份反馈/);
    const reportText = `${await report.inputValue()}\n\n负责人补充：本次为自动化测试示例。`;
    await report.fill(reportText);
    await page.getByRole('button', { name: '保存报告', exact: true }).click();
    await expect(page.getByText('复盘报告已保存', { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('textbox', { name: '复盘报告（可编辑）', exact: true }),
    ).toHaveValue(reportText);

    await page.goto('/app');
    await expect(page.getByRole('heading', { name: '你好，示例组织者。' })).toBeVisible();
    await expect(
      page.locator('.stat').filter({ hasText: '累计报名' }).locator('strong'),
    ).toHaveText('1');
    await noHorizontalOverflow(page);
    await screenshot(page, 'dashboard.png');

    // Confirm that cancelling the browser confirmation preserves data, then
    // exercise the participant erasure control against synthetic test data.
    await page.goto(`${activityPath}?tab=registrations`);
    const deletionRow = page.getByRole('row').filter({ hasText: '示例参与者小林' });
    await expect(deletionRow).toBeVisible();
    page.once('dialog', (dialog) => void dialog.dismiss());
    await deletionRow.getByRole('button', { name: '删除', exact: true }).click();
    await expect(deletionRow).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await deletionRow.getByRole('button', { name: '删除', exact: true }).click();
    await expect(deletionRow).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '正在等待第一位参与者' })).toBeVisible();
  } finally {
    await mobile.close();
  }
});

test('AI 模板保持可编辑草稿，主题持久化，手机工作台可用', async ({ page }) => {
  test.setTimeout(90_000);
  await registerWorkspace(page);
  await page.getByRole('button', { name: '切换深色主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换浅色主题' }).click();
  await page.goto('/app/planner');
  await page
    .getByLabel(/^活动需求/)
    .fill('示例活动：为 80 位同学安排 90 分钟的校园 AIGC 作品交流，时间和场地等待负责人确认。');
  await page.getByRole('button', { name: '生成策划方案' }).click();
  await expect(page.getByText('本地模板 · 非真实 AI 输出', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/^待确认信息/)).toHaveValue(/地点/);
  await page.getByLabel('活动名称', { exact: true }).fill('示例 · 已审核的创意工作坊');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('策划草稿已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '示例 · 已审核的创意工作坊', exact: true }).click();
  await expect(page.getByLabel('活动名称', { exact: true })).toHaveValue(
    '示例 · 已审核的创意工作坊',
  );
  await page.getByRole('button', { name: '确认方案，创建活动' }).click();
  await expect(page).toHaveURL(/\/app\/events\/new$/);
  await expect(page.getByLabel('活动名称', { exact: true })).toHaveValue(
    '示例 · 已审核的创意工作坊',
  );
  await expect(page.getByLabel('活动地点', { exact: true })).toHaveValue('待确认');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.locator('.sidebar').getByRole('link', { name: '我的活动', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/events$/);
  await expect(page.getByRole('heading', { name: '我的活动', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
});

test('首页响应式、未登录访问保护和失效公开链接', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('智能运营团队');
  await expect(page.getByRole('link', { name: '开始创建活动' })).toHaveAttribute(
    'href',
    '/register',
  );
  await screenshot(page, 'landing.png');
  await noHorizontalOverflow(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await noHorizontalOverflow(page);
  await page.goto('/app/events/new');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await page.goto('/events/does-not-exist');
  await expect(page.getByRole('alert')).toContainText('活动尚未发布或不存在');
});
