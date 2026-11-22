import { defineConfig } from '@playwright/test';
import messaging from './messaging-realtime-config';

const servers = Array.isArray(messaging.webServer) ? messaging.webServer : [];

/** The native group journey over the deployed web and realtime policy selection. */
export default defineConfig({
  ...messaging,
  grep: /native group invitation admission and refusal/,
  workers: 1,
  webServer: servers.map((server, index) => ({
    ...server,
    env: {
      ...server.env,
      E2E_STAGING_GROUPS: '1',
      MESSAGING_PRIVATE_GROUPS: 'staging',
      FLY_APP_NAME:
        index === 0 ? 'daisy-debate-staging' : 'daisy-debate-staging-realtime',
    },
  })),
});
