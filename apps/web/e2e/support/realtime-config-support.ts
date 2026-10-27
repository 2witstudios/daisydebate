import { resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';
import {
  resolveE2EOrigin,
  resolveE2EPorts,
  resolveE2EServices,
} from '../../playwright.config';

/**
 * Every simulated member in these suites connects from one loopback
 * address, so the realtime per-address caps (20 sockets, 4 not yet
 * authenticated, 60 upgrades a minute) would refuse later handshakes with
 * 429 while refused pages' retries refill the window. Only these
 * shared-address bounds reflect that many members sit behind it; the
 * per-member cap keeps its production value (ISSUE-652).
 */
const sharedLoopbackCaps = {
  REALTIME_MAX_IP_CONNECTIONS: '10000',
  REALTIME_MAX_UNAUTHENTICATED: '10000',
  REALTIME_MAX_IP_UPGRADES: '10000',
};

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
          ...(index === 1 ? sharedLoopbackCaps : {}),
        },
      };
    }),
  };
}
