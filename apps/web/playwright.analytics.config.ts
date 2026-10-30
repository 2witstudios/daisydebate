import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

const servers = Array.isArray(base.webServer)
  ? base.webServer
  : base.webServer
    ? [base.webServer]
    : [];

/** Separate production-server run: synthetic vendor configuration never changes the ordinary suite. */
export default defineConfig({
  ...base,
  testMatch: '**/analytics-native.e2e.ts',
  // This second run must preserve the ordinary suite's selection evidence.
  outputDir: 'test-results/analytics-native',
  reporter: process.env.CI
    ? [
        ['list'],
        [
          'html',
          { open: 'never', outputFolder: 'playwright-report/analytics-native' },
        ],
        ['json', { outputFile: 'test-results/analytics-native/results.json' }],
      ]
    : 'list',
  projects: [
    {
      name: 'analytics-native',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
  ],
  webServer: servers.map((server, index) =>
    index === 0
      ? {
          ...server,
          reuseExistingServer: false,
          env: {
            ...server.env,
            NEXT_PUBLIC_POSTHOG_KEY: 'phc_browser_fixture',
            NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
            POSTHOG_PERSONAL_API_KEY: 'phx_browser_fixture',
            POSTHOG_PROJECT_ID: '1',
          },
        }
      : server,
  ),
});
