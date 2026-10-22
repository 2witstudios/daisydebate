import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readMediaWorkerConfig, secretConfigKeys } from './index';
setupRitewayBun();
const key = Buffer.alloc(32, 7).toString('base64url');
const worker = {
  NODE_ENV: 'development',
  MEDIA_WORKER_DATABASE_URL:
    'postgres://daisy_media_worker_local:media-worker-loopback-only@localhost:5432/daisy',
  PUBLIC_APP_URL: 'http://localhost:3000',
  MEDIA_WORKER_SECRET: key,
  OPENROUTER_API_KEY: 'test-only-key',
};
const refusal = (env: Record<string, string | undefined>) => {
  try {
    readMediaWorkerConfig(env);
    return 'accepted';
  } catch (error) {
    return String(error);
  }
};

test('the capture worker reads only its own settings', () => {
  assert({
    given: 'the worker settings and an unrelated owner database credential',
    should:
      'keep the worker settings, a bounded session capacity and nothing else',
    actual: readMediaWorkerConfig({
      ...worker,
      DATABASE_URL: 'postgres://owner:secret@localhost:5432/daisy',
    }),
    expected: { ...worker, MEDIA_WORKER_MAX_SESSIONS: 8 },
  });
  assert({
    given: 'the worker database credential and signing key',
    should: 'register both for logger redaction',
    actual: ['MEDIA_WORKER_DATABASE_URL', 'MEDIA_WORKER_SECRET'].every((k) =>
      secretConfigKeys.includes(k),
    ),
    expected: true,
  });
});

test('the capture worker refuses to start without a required setting', () => {
  for (const missing of [
    'MEDIA_WORKER_DATABASE_URL',
    'PUBLIC_APP_URL',
    'MEDIA_WORKER_SECRET',
    'OPENROUTER_API_KEY',
  ])
    assert({
      given: `no ${missing}`,
      should: 'refuse naming the field only',
      actual: refusal({ ...worker, [missing]: undefined }),
      expected: `Error: Invalid media worker configuration: ${missing}`,
    });
  assert({
    given: 'a session capacity outside 1..64',
    should: 'refuse it',
    actual: refusal({ ...worker, MEDIA_WORKER_MAX_SESSIONS: '65' }),
    expected:
      'Error: Invalid media worker configuration: MEDIA_WORKER_MAX_SESSIONS',
  });
});

test('a production capture worker refuses local credentials and plain HTTP', () => {
  assert({
    given: 'production with the loopback database login and an HTTP web URL',
    should: 'refuse both without echoing values',
    actual: refusal({ ...worker, NODE_ENV: 'production' }),
    expected:
      'Error: Invalid media worker configuration: PUBLIC_APP_URL, MEDIA_WORKER_DATABASE_URL',
  });
});
