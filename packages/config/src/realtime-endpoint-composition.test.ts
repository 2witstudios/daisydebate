import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig } from './index';

setupRitewayBun();
test('parsed server config retains an explicit secure endpoint and refuses insecure production', () => {
  const env = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://runtime:fixture@localhost/daisy',
    REDIS_URL: 'redis://localhost',
    PUBLIC_APP_URL: 'https://app.example.test',
    APP_VERSION: '1',
    GIT_COMMIT: 'fixture',
  };
  const endpoint = 'wss://realtime.example.test/ws';
  let refused = false;
  try {
    readServerConfig({
      ...env,
      REALTIME_PUBLIC_URL: 'ws://realtime.example.test/ws',
    });
  } catch {
    refused = true;
  }
  assert({
    given: 'server parsing rather than an independent endpoint parser',
    should:
      'preserve the configured endpoint, keep absence unavailable and refuse insecure production',
    actual: {
      endpoint: readServerConfig({ ...env, REALTIME_PUBLIC_URL: endpoint })
        .REALTIME_PUBLIC_URL,
      absent: readServerConfig(env).REALTIME_PUBLIC_URL ?? null,
      refused,
    },
    expected: { endpoint, absent: null, refused: true },
  });
});
