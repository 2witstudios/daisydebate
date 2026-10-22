import { assert, setupRitewayBun, test } from 'riteway/bun';
import { checkLivekit } from './doctor-media';

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
