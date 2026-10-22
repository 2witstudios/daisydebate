import { assert, setupRitewayBun, test } from 'riteway/bun';
import { checkLivekit, checkMediaWorker } from './doctor-media';

setupRitewayBun();

test('doctor reports local LiveKit reachability and its concrete recovery command', async () => {
  assert({
    given: 'reachable, refused and throwing LiveKit probes',
    should:
      'pass only the reachable service and explain how to start it otherwise',
    actual: await Promise.all([
      checkLivekit(async () => true),
      checkLivekit(async () => false),
      checkLivekit(async () => {
        throw new Error('private transport detail');
      }),
    ]),
    expected: [
      { name: 'livekit', status: 'pass', detail: 'reachable' },
      {
        name: 'livekit',
        status: 'fail',
        detail:
          'unreachable (run docker compose -f infra/compose.yaml up -d livekit)',
      },
      {
        name: 'livekit',
        status: 'fail',
        detail:
          'unreachable (run docker compose -f infra/compose.yaml up -d livekit)',
      },
    ],
  });
});

const worker = {
  NODE_ENV: 'development',
  MEDIA_WORKER_DATABASE_URL:
    'postgres://daisy_media_worker_local:media-worker-loopback-only@localhost:15432/daisy',
  PUBLIC_APP_URL: 'http://localhost:3000',
  MEDIA_WORKER_SECRET: Buffer.alloc(32, 7).toString('base64url'),
  OPENROUTER_API_KEY: 'private-provider-key',
};

test('doctor reports whether the capture worker is configured under its own role', async () => {
  assert({
    given:
      'no worker settings, a role-scoped login, a broader login and an unreachable database',
    should:
      'warn with field names only, pass, and fail without echoing any value',
    actual: await Promise.all([
      checkMediaWorker({ NODE_ENV: 'development' }, async () => []),
      checkMediaWorker(worker, async () => []),
      checkMediaWorker(worker, async () => ['superuser', 'writes']),
      checkMediaWorker(worker, async () => {
        throw new Error('private transport detail');
      }),
    ]),
    expected: [
      {
        name: 'media-worker',
        status: 'warn',
        detail:
          'not configured: MEDIA_WORKER_DATABASE_URL, PUBLIC_APP_URL, MEDIA_WORKER_SECRET, OPENROUTER_API_KEY',
      },
      {
        name: 'media-worker',
        status: 'pass',
        detail: 'configured as daisy_media_worker',
      },
      {
        name: 'media-worker',
        status: 'fail',
        detail: 'login broader than daisy_media_worker: superuser, writes',
      },
      {
        name: 'media-worker',
        status: 'fail',
        detail: 'database unreachable (run bun slot:up)',
      },
    ],
  });
});
