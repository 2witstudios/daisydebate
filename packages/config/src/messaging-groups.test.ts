import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readServerConfig, readRealtimeConfig } from './index';
import { env } from './server-env.test-support';

setupRitewayBun();

const deployed = {
  ...env,
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:production@db.example.com:5432/daisy',
  REDIS_URL: 'redis://cache.example.com:6379',
  PUBLIC_APP_URL: 'https://beta.daisydebate.com',
  APP_VERSION: '1.0.0',
  GIT_COMMIT: 'abc1234',
};
const selection = (
  read: typeof readServerConfig | typeof readRealtimeConfig,
  input: Record<string, string>,
) => {
  try {
    return read(input).MESSAGING_PRIVATE_GROUPS ?? 'off';
  } catch {
    return 'refused';
  }
};

test('private group activation is explicit and bound to the staging process', () => {
  for (const [read, name] of [
    [readServerConfig, 'daisy-debate-staging'],
    [readRealtimeConfig, 'daisy-debate-staging-realtime'],
  ] as const) {
    const on = { MESSAGING_PRIVATE_GROUPS: 'staging' };
    assert({
      given:
        'absent activation, named staging, missing/wrong/production identity, local proof and an invalid flag',
      should:
        'default off, admit only the correct deployed staging identity or explicit local proof',
      actual: [
        selection(read, deployed),
        selection(read, { ...deployed, ...on, FLY_APP_NAME: name }),
        selection(read, { ...deployed, ...on }),
        selection(read, { ...deployed, ...on, FLY_APP_NAME: `${name}-wrong` }),
        selection(read, {
          ...deployed,
          ...on,
          FLY_APP_NAME: 'daisy-debate-production',
        }),
        selection(read, { ...env, ...on }),
        selection(read, { ...env, MESSAGING_PRIVATE_GROUPS: 'enabled' }),
      ],
      expected: [
        'off',
        'staging',
        'refused',
        'refused',
        'refused',
        'staging',
        'refused',
      ],
    });
  }
});
