import { defineConfig, devices } from '@playwright/test';
import {
  e2eOperatorApi,
  e2eOperatorEnv,
} from './e2e/support/operator-api-fixture';

/**
 * The admin journey (ADR 0077): one production server on the canonical
 * origin, https://localhost:4800 through an ephemeral TLS proxy, which WebAuthn and the Host gate both
 * require, so a machine runs one admin browser suite at a time. The owner
 * URL of the e2e database comes only from E2E_ADMIN_DATABASE_URL (written by
 * `bun slot:up`, set by CI); the server runs as a DML-only login. A
 * verifying stand-in for the participant app's operator API listens on
 * localhost:4801.
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
  use: {
    baseURL: 'https://localhost:4800',
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: [
    {
      command: 'bun e2e/support/https-proxy.ts',
      url: 'https://localhost:4800/proxy-ready',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
    },
    {
      command: 'bun e2e/support/operator-api-server.ts',
      url: `http://localhost:${e2eOperatorApi.port}/ready`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'bun e2e/support/prepare.ts && bun src/server/start.ts',
      url: 'https://localhost:4800/sign-in',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        ADMIN_ORIGIN: 'https://localhost:4800',
        ADMIN_PORT: '4802',
        E2E_ADMIN_DATABASE_URL: ownerUrl,
        ADMIN_DATABASE_URL: ownerUrl === '' ? '' : runtimeUrl(ownerUrl),
        ADMIN_ATTEMPT_KEY: 'admin-e2e-attempt-key-loopback-only-000000',
        ...e2eOperatorEnv,
      },
    },
  ],
});

function runtimeUrl(owner: string): string {
  const url = new URL(owner);
  url.username = 'daisy_admin_e2e';
  url.password = 'admin-e2e-loopback-only';
  return url.toString();
}
