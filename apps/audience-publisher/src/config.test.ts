import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readPublisherConfig } from './config';

setupRitewayBun();

const env = {
  AUDIENCE_PUBLISHER_DATABASE_URL: 'postgres://p@h/d',
  BROADCAST_STORAGE_ENDPOINT: 'https://s.invalid',
  BROADCAST_PUBLIC_BUCKET: 'public',
  BROADCAST_PUBLIC_KEY: 'k',
  BROADCAST_PUBLIC_SECRET: 's',
  BROADCAST_PUBLIC_ORIGIN: 'https://feed.invalid',
  REDIS_URL: 'redis://h:6379/0',
  REDIS_NAMESPACE: 'daisy-test',
};

test('it runs fully configured or not at all', () => {
  assert({
    given: 'a full environment',
    should: 'read it',
    actual: readPublisherConfig(env).BROADCAST_PUBLIC_BUCKET,
    expected: 'public',
  });
  let refused = false;
  try {
    readPublisherConfig({ ...env, REDIS_URL: undefined });
  } catch {
    refused = true;
  }
  assert({
    given: 'an environment lacking Redis',
    should: 'refuse to start',
    actual: refused,
    expected: true,
  });
});
