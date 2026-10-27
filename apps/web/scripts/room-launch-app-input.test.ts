import { readServerConfig } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { launchAppInput } from '../e2e/support/room-launch-app-input';
import { launchWorkerEnv } from '../e2e/support/room-launch-worker-policy';
import { roundWorkerDatabaseOptions } from '../src/server/round-worker-policy';
setupRitewayBun();
test('the launch browser server composes its configured round workers', () => {
  const env = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy',
    REDIS_URL: 'redis://localhost:6379',
    PUBLIC_APP_URL: 'http://localhost:3000',
    ...launchWorkerEnv,
  };
  const input = launchAppInput(env, fetch);
  const startup = () =>
    roundWorkerDatabaseOptions(readServerConfig(env), input.nextWorkerToken);
  let refusal: unknown = null;
  try {
    startup();
  } catch (error) {
    refusal = error instanceof Error ? error.message : error;
  }
  const tokens = [input.nextWorkerToken?.(), input.nextWorkerToken?.()];
  assert({
    given: 'the launch app input and its explicit worker policy',
    should:
      'pass the startup worker check with distinct 256-bit base64url tokens',
    actual: {
      refusal,
      shapes: tokens.map((token) => /^[A-Za-z0-9_-]{43}$/.test(token ?? '')),
      distinct: tokens[0] !== tokens[1],
    },
    expected: { refusal: null, shapes: [true, true], distinct: true },
  });
});
