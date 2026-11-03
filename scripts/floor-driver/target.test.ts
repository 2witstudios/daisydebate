import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseDriverArgs, readTarget, targetRefusals } from './target';

setupRitewayBun();

const local = {
  FLOOR_ORIGIN: 'https://localhost:13021',
  FLOOR_MAIL_CAPTURE_URL: 'http://127.0.0.1:13022',
  FLOOR_DATABASE_URL: 'postgres://daisy_e2e:x@localhost:5432/daisy_wt_a_e2e',
  FLOOR_LIVEKIT_URL: 'http://127.0.0.1:7880',
  FLOOR_LIVEKIT_API_KEY: 'key',
  FLOOR_LIVEKIT_API_SECRET: 'secret',
};
const refusals = (env: Record<string, string>) =>
  targetRefusals(readTarget({ ...local, ...env }));

test('a target is refused unless every part of it is known not to be production', () => {
  assert({
    given: 'a local stack',
    should: 'be accepted',
    actual: refusals({}),
    expected: [],
  });
  assert({
    given: 'the public production origin',
    should: 'be refused',
    actual: refusals({ FLOOR_ORIGIN: 'https://daisydebate.com' }),
    expected: ['origin host daisydebate.com is production'],
  });
  assert({
    given: 'production named as a rig',
    should: 'still be refused, since a rig list cannot excuse it',
    actual: refusals({
      FLOOR_ORIGIN: 'https://app.daisydebate.com',
      FLOOR_RIG_HOSTS: 'app.daisydebate.com',
    }),
    expected: ['origin host app.daisydebate.com is production'],
  });
  assert({
    given: 'a host naming production on any provider',
    should: 'be refused even when listed',
    actual: refusals({
      FLOOR_LIVEKIT_URL: 'https://daisy-debate-production-livekit.fly.dev',
      FLOOR_RIG_HOSTS: 'daisy-debate-production-livekit.fly.dev',
    }),
    expected: [
      'livekit host daisy-debate-production-livekit.fly.dev is production',
    ],
  });
  assert({
    given: 'a scratch rig named host by host',
    should: 'be accepted, and a suffix of a name is not that name',
    actual: [
      refusals({
        FLOOR_ORIGIN: 'https://floor-rig.fly.dev',
        FLOOR_RIG_HOSTS: 'floor-rig.fly.dev',
      }),
      refusals({
        FLOOR_ORIGIN: 'https://evil-floor-rig.fly.dev',
        FLOOR_RIG_HOSTS: 'floor-rig.fly.dev',
      }),
    ],
    expected: [
      [],
      ['origin host evil-floor-rig.fly.dev is not loopback or a named rig'],
    ],
  });
  assert({
    given: 'a database not named for a test or a rig',
    should: 'be refused',
    actual: refusals({
      FLOOR_DATABASE_URL: 'postgres://daisy:x@localhost:5432/daisy',
    }),
    expected: ['database daisy does not end in _e2e or _rig'],
  });
});

test('arguments state N and a profile, with no default to measure by accident', () => {
  assert({
    given: 'N and a profile',
    should: 'read them with the 500 deadline floor',
    actual: parseDriverArgs(['--n', '10', '--profile', 'held']),
    expected: {
      n: 10,
      profile: 'held',
      deadlines: 500,
      countdownMs: 1_000,
      holdMs: 500,
      pollMs: 50,
      maxMinutes: 60,
      control: false,
      controlBoundMs: 500,
    },
  });
  assert({
    given: 'an unknown profile',
    should: 'refuse',
    actual: (() => {
      try {
        return parseDriverArgs(['--n', '2', '--profile', 'fast']);
      } catch (error) {
        return (error as Error).message;
      }
    })(),
    expected: '--profile must be live or held',
  });
});
