import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import launch from './room-launch-config';

const web = resolve(import.meta.dirname, '../..');

/** The Launch harness for the first-word proof: real capture, real speech-to-text. */
export default defineConfig({
  ...launch,
  testMatch: ['**/first-word.e2e.ts'],
  use: { ...launch.use, trace: 'off' },
  projects: (launch.projects ?? []).map((project) => ({
    ...project,
    use: { ...project.use, trace: 'off' },
  })),
  timeout: 900_000,
  outputDir: resolve(web, 'test-results/first-word-output'),
  reporter: [['list']],
});
