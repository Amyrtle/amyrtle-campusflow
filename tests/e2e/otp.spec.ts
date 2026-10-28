import { test, expect, type Page } from '@playwright/test';

type OtpHarness = {
  sent: string[];
  verified: string[];
  signedInAs: string[];
  submittedTokens: string[];
  publicTokenReads: number;
  delaySend: boolean;
  isUser: boolean;
  grantSession: boolean;
  signedIn: boolean;
  signUpError: string | null;
  releaseSend?: () => void;
};

declare global {
  interface Window {
    __otpHarness: OtpHarness;
  }
}

async function mockCloudAuth(page: Page) {
  await page.addInitScript(() => {
    window.__otpHarness = {
      sent: [],
      verified: [],
      signedInAs: [],
      submittedTokens: [],
      publicTokenReads: 0,
      delaySend: false,
      isUser: true,
      grantSession: true,
      signedIn: false,
      signUpError: null,
    };
  });
  // Replace only the local Vite auth adapter. No email provider is contacted.
  await page.route('**/src/cloudbase.ts*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
      const state = globalThis.__otpHarness;
      const session = () => state.signedIn ? { access_token: 'mock-user-session-token', user: { id: 'otp-test-user', email: 'organizer@example.test', is_anonymous: false } } : undefined;
      const auth = {
        async getVerification({ email }) {
          state.sent.push(email);
          if (state.delaySend) await new Promise(resolve => { state.releaseSend = resolve; });
          return { verification_id: 'challenge-for-' + email, is_user: state.isUser };
        },
        async verify({ verification_id, verification_code }) {
          state.verified.push(verification_id);
          if (verification_code === '000000') throw new Error('验证码不正确，请重试');
          return { verification_token: 'mock-verified-token', expires_in: 300 };
        },
        async signIn({ username }) { state.signedInAs.push(username); state.signedIn = state.grantSession; },
        async signUp({ email }) {
          if (state.signUpError) return { data: {}, error: { message: state.signUpError } };
          state.signedInAs.push(email); state.signedIn = state.grantSession;
          return { data: {}, error: null };
        },
        async getSession() { return { data: { session: session() }, error: null }; },
        async getAccessToken() { state.publicTokenReads += 1; return { accessToken: 'mock-publishable-key' }; }
      };
      export const cloudEnabled = true;
      export async function getCloudAuth() { return auth; }
      export async function cloudToken() { return session()?.access_token ?? null; }
    `,
    }),
  );
  await page.route('**/api/auth/session', async (route) => {
    const authenticated = await page.evaluate(() => window.__otpHarness.submittedTokens.length > 0);
    await route.fulfill({
      status: authenticated ? 200 : 401,
      json: authenticated
        ? {
            user: {
              id: 'otp-test-user',
              email: 'organizer@example.test',
              display_name: '验证码测试',
            },
            organizations: [],
            mode: 'cloudbase',
          }
        : { error: { code: 'UNAUTHENTICATED', message: '请先登录' } },
    });
  });
  await page.route('**/api/auth/cloudbase', async (route) => {
    const body = route.request().postDataJSON() as { access_token: string };
    await page.evaluate(
      (token) => window.__otpHarness.submittedTokens.push(token),
      body.access_token,
    );
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/login');
  await expect(page.getByText('CloudBase 邮箱认证', { exact: true })).toBeVisible();
}

test.beforeEach(async ({ request, page }) => {
  const health = await request.get('/api/health');
  expect(await health.json()).toMatchObject({ database: 'pglite', auth_mode: 'local' });
  await mockCloudAuth(page);
});

test('发送期间更换邮箱不会采用旧请求的验证码', async ({ page }) => {
  await page.evaluate(() => {
    window.__otpHarness.delaySend = true;
  });
  await page.getByLabel('邮箱', { exact: true }).fill('old@example.test');
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__otpHarness.sent.length)).toBe(1);
  await page.getByLabel('邮箱', { exact: true }).fill('new@example.test');
  await page.evaluate(() => {
    window.__otpHarness.releaseSend?.();
  });
  await expect(page.getByRole('button', { name: '发送验证码', exact: true })).toBeEnabled();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByRole('alert')).toHaveText('请先为当前邮箱发送验证码');
  expect(await page.evaluate(() => window.__otpHarness.verified.length)).toBe(0);
  expect(await page.evaluate(() => window.__otpHarness.submittedTokens.length)).toBe(0);
});

test('发送后冷却、错误验证码重试与真实会话提交', async ({ page }) => {
  await page.clock.install();
  await page.getByLabel('邮箱', { exact: true }).fill('organizer@example.test');
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await expect(page.getByRole('button', { name: '60 秒后重发', exact: true })).toBeDisabled();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('000000');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByRole('alert')).toHaveText('验证码不正确，请重试');
  await expect(page.getByRole('button', { name: '登录工作台' })).toBeEnabled();
  await page.clock.fastForward(60000);
  await expect(page.getByRole('button', { name: '发送验证码', exact: true })).toBeEnabled();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page).toHaveURL(/\/app$/);
  expect(await page.evaluate(() => window.__otpHarness.submittedTokens)).toEqual([
    'mock-user-session-token',
  ]);
  expect(await page.evaluate(() => window.__otpHarness.publicTokenReads)).toBe(0);
  expect(await page.evaluate(() => window.__otpHarness.sent)).toEqual(['organizer@example.test']);
});

test('注册返回 SDK 错误时不向业务 API 提交凭证', async ({ page }) => {
  await page.evaluate(() => {
    window.__otpHarness.isUser = false;
    window.__otpHarness.signUpError = '邮箱注册暂不可用，请稍后重试';
  });
  await page.getByLabel('邮箱', { exact: true }).fill('new@example.test');
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByRole('alert')).toHaveText('邮箱注册暂不可用，请稍后重试');
  expect(await page.evaluate(() => window.__otpHarness.submittedTokens.length)).toBe(0);
});

test('没有真实用户会话时拒绝发布 key 回退', async ({ page }) => {
  await page.evaluate(() => {
    window.__otpHarness.grantSession = false;
  });
  await page.getByLabel('邮箱', { exact: true }).fill('organizer@example.test');
  await page.getByRole('button', { name: '发送验证码', exact: true }).click();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '登录工作台' }).click();
  await expect(page.getByRole('alert')).toHaveText('未取得有效登录会话，请重新登录。');
  expect(await page.evaluate(() => window.__otpHarness.submittedTokens.length)).toBe(0);
  expect(await page.evaluate(() => window.__otpHarness.publicTokenReads)).toBe(0);
});
