import { resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import {
  resolveE2EOrigin,
  resolveE2EPorts,
  resolveE2EServices,
} from '../../playwright.config';

/** Both native realtime profiles use the same actual TLS process and slot namespace. */
export function realtimeBrowserProcesses(
  canonical: PlaywrightTestConfig,
  env: Readonly<Record<string, string | undefined>>,
  web: string,
  webCommand?: string,
) {
  const ports = resolveE2EPorts(env);
  const services = resolveE2EServices(env);
  const servers = Array.isArray(canonical.webServer)
    ? canonical.webServer
    : [canonical.webServer];
  const chromium = canonical.projects?.find(
    (project) => project.name === 'chromium',
  );
  if (!chromium || servers.length !== 2 || !servers[0] || !servers[1])
    throw new Error('Canonical realtime browser processes are unavailable');
  return {
    chromium,
    webServer: servers.map((server, index) => {
      if (!server) throw new Error('Canonical browser server unavailable');
      return {
        ...server,
        cwd: resolve(web, server.cwd ?? '.'),
        command:
          index === 0
            ? (webCommand ?? server.command)
            : server.command.replace(
                'src/start.ts',
                'integration/browser-server.ts',
              ),
        ...(index === 1
          ? {
              url: `https://localhost:${ports.realtime}/health/ready`,
              ignoreHTTPSErrors: true,
            }
          : {}),
        reuseExistingServer: false,
        env: {
          ...server.env,
          ...services,
          E2E_DATABASE_URL: env.E2E_DATABASE_URL!,
          E2E_REDIS_URL: env.E2E_REDIS_URL!,
          E2E_REDIS_NAMESPACE: env.E2E_REDIS_NAMESPACE!,
          E2E_PORT: env.E2E_PORT!,
          REALTIME_PUBLIC_URL: `wss://localhost:${ports.realtime}/ws`,
          REALTIME_ALLOWED_ORIGINS: resolveE2EOrigin(env),
        },
      };
    }),
  };
}
