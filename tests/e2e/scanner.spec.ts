import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import type { Activity, Session, Ticket } from '@campusflow/shared';

type ScannerHarness = {
  requests: number;
  streams: MediaStream[];
  reveal: boolean;
};
declare global {
  interface Window {
    __scannerHarness?: ScannerHarness;
  }
}

async function setupCheckin(page: Page) {
  const health = await page.request.get('/api/health');
  expect(await health.json()).toMatchObject({
    database: 'pglite',
    auth_mode: 'local',
    ai_mode: 'mock',
  });
  const key = randomUUID();
  const registration = await page.request.post('/api/auth/register', {
    data: {
      email: `scanner-${key}@example.test`,
      password: `Camera-Test-${key}!`,
      display_name: '扫码自动验收员',
      organization_name: `扫码虚构测试 ${key}`,
    },
  });
  expect(registration.status()).toBe(201);
  const session = (await registration.json()) as Session;
  const response = await page.request.post(
    `/api/organizations/${session.organizations[0].id}/activities`,
    {
      data: {
        title: '摄像头浏览器模拟测试',
        description: '仅合成信息，不是真实手机验收',
        location: '虚构测试教室',
        start_time: new Date(Date.now() + 3600000).toISOString(),
        end_time: new Date(Date.now() + 7200000).toISOString(),
        registration_start: new Date(Date.now() - 3600000).toISOString(),
        registration_deadline: new Date(Date.now() + 1800000).toISOString(),
        capacity: 5,
        form_fields: [],
      },
    },
  );
  expect(response.status()).toBe(201);
  const activity = (await response.json()) as Activity;
  expect(
    (
      await page.request.post(`/api/activities/${activity.id}/status`, {
        data: { status: 'Published' },
      })
    ).ok(),
  ).toBeTruthy();
  const ticketResponse = await page.request.post(`/api/public/events/${activity.slug}/register`, {
    data: {
      display_name: '虚构扫码参与者',
      answers: {},
      consent: true,
      idempotency_key: randomUUID(),
    },
  });
  expect(ticketResponse.status()).toBe(201);
  const ticket = (await ticketResponse.json()) as Ticket;
  expect(
    (
      await page.request.post(`/api/activities/${activity.id}/status`, {
        data: { status: 'InProgress' },
      })
    ).ok(),
  ).toBeTruthy();
  return { path: `/app/events/${activity.id}?tab=checkin`, activity, ticket };
}

async function syntheticCamera(page: Page, token: string, stallPlayback = false) {
  const dataUrl = await QRCode.toDataURL(token, {
    width: 480,
    margin: 4,
    errorCorrectionLevel: 'M',
  });
  await page.addInitScript(
    ({ dataUrl, stallPlayback }) => {
      const harness: ScannerHarness = { requests: 0, streams: [], reveal: false };
      window.__scannerHarness = harness;
      if (stallPlayback) HTMLMediaElement.prototype.play = () => new Promise<void>(() => undefined);
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          if (constraints.audio !== false)
            throw new Error('Scanner must never request microphone access');
          harness.requests++;
          const picture = new Image();
          picture.src = dataUrl;
          await picture.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 640;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Synthetic camera canvas unavailable');
          const draw = () => {
            context.fillStyle = 'white';
            context.fillRect(0, 0, 640, 640);
            if (harness.reveal) context.drawImage(picture, 80, 80, 480, 480);
          };
          draw();
          const stream = canvas.captureStream(12);
          harness.streams.push(stream);
          const timer = window.setInterval(() => {
            if (stream.getTracks().every((track) => track.readyState === 'ended'))
              window.clearInterval(timer);
            else draw();
          }, 80);
          return stream;
        },
      });
    },
    { dataUrl, stallPlayback },
  );
}

test('拒绝摄像头后仍能手动签到', async ({ page }) => {
  const { path, ticket } = await setupCheckin(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        throw new DOMException('Permission denied by test', 'NotAllowedError');
      },
    });
  });
  await page.goto(path);
  await page.getByRole('button', { name: '开启摄像头扫码', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '未获得摄像头权限' })).toBeVisible();
  await page.getByLabel('手动输入签到码', { exact: true }).fill(ticket.token);
  await page.getByRole('button', { name: '核验并签到', exact: true }).click();
  await expect(page.getByRole('heading', { name: '签到成功', exact: true })).toBeVisible();
});

test('摄像头已开启但视频尚未就绪时停止扫描仍释放轨道', async ({ page }) => {
  const { path, ticket } = await setupCheckin(page);
  await syntheticCamera(page, ticket.token, true);
  await page.goto(path);
  await page.getByRole('button', { name: '开启摄像头扫码', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__scannerHarness?.streams.length)).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => window.__scannerHarness?.streams[0].getVideoTracks()[0].readyState),
    )
    .toBe('live');
  await page.getByRole('button', { name: '停止扫描', exact: true }).click();
  await expect
    .poll(
      () => page.evaluate(() => window.__scannerHarness?.streams[0].getVideoTracks()[0].readyState),
      { timeout: 2000 },
    )
    .toBe('ended');
});

test('真实解码器识别合成视频二维码，失败后暂停并允许重试与重复签到', async ({ page }) => {
  const { path, activity, ticket } = await setupCheckin(page);
  await syntheticCamera(page, ticket.token);
  let checkinRequests = 0;
  await page.route(`**/api/activities/${activity.id}/checkin`, async (route) => {
    checkinRequests++;
    if (checkinRequests === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'TEST_UNAVAILABLE', message: '合成测试：短暂网络故障，请重试。' },
        }),
      });
    } else await route.continue();
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(path);
  await page.getByRole('button', { name: '开启摄像头扫码', exact: true }).click();
  await expect(page.locator('video')).toHaveAttribute('playsinline', '');
  await expect
    .poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    if (window.__scannerHarness) window.__scannerHarness.reveal = true;
  });
  await expect(page.getByRole('heading', { name: '未能签到', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开启摄像头扫码', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__scannerHarness?.streams[0]
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
    )
    .toBe(true);
  expect(checkinRequests).toBe(1);

  await page.getByRole('button', { name: '开启摄像头扫码', exact: true }).click();
  await expect(page.getByRole('heading', { name: '签到成功', exact: true })).toBeVisible();
  expect(checkinRequests).toBe(2);
  await page.getByRole('button', { name: '开启摄像头扫码', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '已经签到，无需重复', exact: true }),
  ).toBeVisible();
  expect(checkinRequests).toBe(3);
  const registrations = await page.request.get(`/api/activities/${activity.id}/registrations`);
  const rows = (await registrations.json()) as { checked_in_at: string | null }[];
  expect(rows).toHaveLength(1);
  expect(rows[0].checked_in_at).toBeTruthy();
  expect(pageErrors).toEqual([]);
});
