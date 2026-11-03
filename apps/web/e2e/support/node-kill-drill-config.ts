import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { readDrillTarget } from '../../scripts/node-kill-drill/target';
import launch from './room-launch-config';

const target = readDrillTarget(process.env);
const web = resolve(import.meta.dirname, '../..');
const servers = Array.isArray(launch.webServer)
  ? launch.webServer
  : [launch.webServer!];

/** The Launch harness pointed at the scratch nodes. Refuses anything else. */
export default defineConfig({
  ...launch,
  testMatch: ['**/node-kill-drill.e2e.ts'],
  use: { ...launch.use, trace: 'off' },
  projects: (launch.projects ?? []).map((project) => ({
    ...project,
    use: { ...project.use, trace: 'off' },
  })),
  timeout: 900_000,
  outputDir: resolve(web, 'test-results/node-kill-drill-output'),
  reporter: [['list']],
  webServer: servers.map((server) => ({
    ...server,
    env: {
      ...server.env,
      LIVEKIT_URL: target.nodes.map((node) => node.apiUrl).join(','),
      LIVEKIT_PUBLIC_URL: target.nodes.map((node) => node.publicUrl).join(','),
      LIVEKIT_API_KEY: target.apiKey,
      LIVEKIT_API_SECRET: target.apiSecret,
      ROOM_LAUNCH_MEDIA_EDGES: process.env.ROOM_LAUNCH_MEDIA_EDGES ?? '',
    },
  })),
});
