import { defineConfig, devices } from '@playwright/test';

/**
 * The admin journey (ADR 0076): one production server on the canonical
 * origin, http://localhost:4800, which WebAuthn and the Host gate both
 * require, so a machine runs one admin browser suite at a time. The owner
 * URL of the e2e database comes only from E2E_ADMIN_DATABASE_URL (written by
 * `bun slot:up`, set by CI); the server runs as a DML-only login.
 */
const ownerUrl = process.env.E2E_ADMIN_DATABASE_URL ?? '';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'test-results/results.json' }]]
    : 'list',
  use: { baseURL: 'http://localhost:4800', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun e2e/support/prepare.ts && bun src/server/start.ts',
    url: 'http://localhost:4800/sign-in',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      E2E_ADMIN_DATABASE_URL: ownerUrl,
      ADMIN_DATABASE_URL: ownerUrl === '' ? '' : runtimeUrl(ownerUrl),
      ADMIN_ATTEMPT_KEY: 'admin-e2e-attempt-key-loopback-only-000000',
    },
  },
});

function runtimeUrl(owner: string): string {
  const url = new URL(owner);
  url.username = 'daisy_admin_e2e';
  url.password = 'admin-e2e-loopback-only';
  return url.toString();
}
