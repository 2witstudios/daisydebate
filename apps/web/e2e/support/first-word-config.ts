import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { readDrillTarget } from '../../scripts/node-kill-drill/target';
import launch from './room-launch-config';

const web = resolve(import.meta.dirname, '../..');
// Pointed at real nodes when the drill's own settings name them; else the local stack.
const target = process.env.DRILL_NODES ? readDrillTarget(process.env) : null;
const servers = Array.isArray(launch.webServer)
  ? launch.webServer
  : [launch.webServer!];

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
  webServer: target
    ? servers.map((server) => ({
        ...server,
        env: {
          ...server.env,
          LIVEKIT_URL: target.nodes.map((node) => node.apiUrl).join(','),
          LIVEKIT_PUBLIC_URL: target.nodes
            .map((node) => node.publicUrl)
            .join(','),
          LIVEKIT_API_KEY: target.apiKey,
          LIVEKIT_API_SECRET: target.apiSecret,
          ROOM_LAUNCH_MEDIA_EDGES: '',
        },
      }))
    : servers,
});
