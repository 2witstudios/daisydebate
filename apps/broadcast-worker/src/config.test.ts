import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readWorkerConfig } from './config';

setupRitewayBun();

const env = {
  BROADCAST_WORKER_DATABASE_URL: 'postgres://u@h/d',
  AUDIENCE_PUBLISHER_DATABASE_URL: 'postgres://p@h/d',
  BROADCAST_PUBLIC_ORIGIN: 'https://feed.invalid',
  REDIS_URL: 'redis://h:6379/0',
  REDIS_NAMESPACE: 'daisy-test',
  BROADCAST_STORAGE_ENDPOINT: 'https://s.test',
  BROADCAST_HOLD_BUCKET: 'hold',
  BROADCAST_HOLD_KEY: 'k',
  BROADCAST_HOLD_SECRET: 's',
  BROADCAST_PUBLIC_BUCKET: 'pub',
  BROADCAST_PUBLIC_KEY: 'k2',
  BROADCAST_PUBLIC_SECRET: 's2',
};

test('the worker refuses to start half configured', () => {
  const missing = { ...env, BROADCAST_PUBLIC_KEY: undefined };
  assert({
    given: 'a full environment, and one lacking the public key',
    should: 'default the slots, and refuse the second',
    actual: [
      readWorkerConfig(env).BROADCAST_WORKER_SLOTS,
      (() => {
        try {
          readWorkerConfig(missing);
          return 'accepted';
        } catch {
          return 'refused';
        }
      })(),
    ],
    expected: [4, 'refused'],
  });
});
