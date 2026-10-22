import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readBrowserConfig, readServerConfig, secretConfigKeys } from './index';
setupRitewayBun();
const baseline = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:secret@localhost:5432/daisy_test',
  REDIS_URL: 'redis://localhost:6379',
  PUBLIC_APP_URL: 'http://localhost:3000',
};
const media = {
  LIVEKIT_URL: 'http://127.0.0.1:7880',
  LIVEKIT_PUBLIC_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-only-secret',
};
test('media configuration stays optional and server-only', () => {
  const config = readServerConfig({ ...baseline, ...media });
  assert({
    given: 'explicit media settings',
    should: 'retain every setting on the server only',
    actual: Object.fromEntries(
      Object.keys(media).map((key) => [key, Reflect.get(config, key)]),
    ),
    expected: media,
  });
  assert({
    given: 'media credentials in the environment',
    should: 'exclude them and the vendor endpoint from the browser allowlist',
    actual: readBrowserConfig({ ...baseline, ...media }),
    expected: { PUBLIC_APP_URL: baseline.PUBLIC_APP_URL },
  });
  assert({
    given: 'media is not configured',
    should: 'allow baseline startup without activating media',
    actual: Reflect.get(readServerConfig(baseline), 'LIVEKIT_URL'),
    expected: undefined,
  });
});
test('internal media signing key is optional, canonical and redacted', () => {
  const key = Buffer.alloc(32, 7).toString('base64url');
  const env = { ...baseline, MEDIA_WORKER_SECRET: key };
  assert({
    given: 'an explicitly injected test signing key or no configuration',
    should: 'keep the secret server-only and register logger redaction',
    actual: [
      Reflect.get(readServerConfig(env), 'MEDIA_WORKER_SECRET') === key,
      Reflect.get(readServerConfig(baseline), 'MEDIA_WORKER_SECRET'),
      Reflect.get(readBrowserConfig(env), 'MEDIA_WORKER_SECRET'),
      secretConfigKeys.includes('MEDIA_WORKER_SECRET'),
    ],
    expected: [true, undefined, undefined, true],
  });
  for (const invalid of [
    Buffer.alloc(31).toString('base64url'),
    `${key}=`,
    `${key} `,
    'private-invalid-value',
  ]) {
    let message = 'accepted';
    try {
      readServerConfig({ ...baseline, MEDIA_WORKER_SECRET: invalid });
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'invalid internal signing configuration',
      should: 'refuse with field name only',
      actual: message,
      expected: 'Error: Invalid server configuration: MEDIA_WORKER_SECRET',
    });
  }
});
test('media configuration refuses invalid schemes and credential-bearing URLs safely', () => {
  for (const value of [
    { LIVEKIT_URL: 'private malformed endpoint' },
    { LIVEKIT_URL: 'file:///private' },
    { LIVEKIT_URL: 'http://private-secret@localhost:7880' },
    { LIVEKIT_PUBLIC_URL: 'http://localhost:7880' },
    { LIVEKIT_API_SECRET: 'private secret' },
  ]) {
    let message = 'accepted';
    try {
      readServerConfig({ ...baseline, ...value });
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'invalid media configuration',
      should: 'reject it without revealing values',
      actual: [
        message.startsWith('Error: Invalid server configuration:'),
        message.includes('private'),
      ],
      expected: [true, false],
    });
  }
});
