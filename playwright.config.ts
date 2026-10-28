import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        PORT: '3001',
        HOST: '127.0.0.1',
        DATA_DIR: '.data/e2e',
        AUTH_MODE: 'local',
        MOCK_AI_MODE: 'true',
        APP_ORIGIN: 'http://127.0.0.1:5173',
      },
    },
  ],
});
