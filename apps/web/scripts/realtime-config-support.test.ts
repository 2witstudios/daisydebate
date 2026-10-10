import { assert, setupRitewayBun, test } from 'riteway/bun';
import { realtimeBrowserProcesses } from '../e2e/support/realtime-config-support';
setupRitewayBun();
test('both actual native processes preserve their common namespace, TLS and web anchor', () => {
  const env = {
    E2E_PORT: '13001',
    E2E_DATABASE_URL: 'postgres://fixture',
    E2E_REDIS_URL: 'redis://fixture/2',
    E2E_REDIS_NAMESPACE: 'fixture-e2e',
  };
  const result = realtimeBrowserProcesses(
    {
      projects: [{ name: 'chromium' }],
      webServer: [
        { command: 'bun e2e/support/server.ts' },
        { command: 'bun src/start.ts' },
      ],
    },
    env,
    '/proof/apps/web',
  );
  assert({
    given: 'the two canonical process entries and an explicit proof slot',
    should:
      'mount the TLS realtime entry, anchor the web cwd and bind both to actual common resources',
    actual: result.webServer.map((server) => ({
      command: server.command,
      cwd: server.cwd,
      namespace: server.env.REDIS_NAMESPACE,
      endpoint: server.env.REALTIME_PUBLIC_URL,
      reuse: server.reuseExistingServer,
    })),
    expected: [
      {
        command: 'bun e2e/support/server.ts',
        cwd: '/proof/apps/web',
        namespace: 'fixture-e2e',
        endpoint: 'wss://localhost:13004/ws',
        reuse: false,
      },
      {
        command: 'bun integration/browser-server.ts',
        cwd: '/proof/apps/web',
        namespace: 'fixture-e2e',
        endpoint: 'wss://localhost:13004/ws',
        reuse: false,
      },
    ],
  });
});
