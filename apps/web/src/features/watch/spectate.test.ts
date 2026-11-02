import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { WatchRound, WatchViewer } from './round';
import { decideSpectate } from './spectate';

setupRitewayBun();

const seat = (handle: string) =>
  ({ handle, rating: 1500, standing: 'established' }) as const;

const round = (over: Partial<WatchRound> = {}): WatchRound => ({
  id: 'd',
  title: 'D',
  mode: 'ranked',
  customRules: false,
  visibility: 'public',
  aff: seat('aff'),
  neg: seat('neg'),
  judges: ['judge'],
  removedSpectators: [],
  audienceFull: false,
  state: { status: 'live', turnIndex: 0, speechSecondsLeft: 10, watching: 1 },
  ...over,
});

const member = (handle: string): WatchViewer => ({
  signedIn: true,
  handle,
});
const nobody: WatchViewer = { signedIn: false };

describe('decideSpectate', () => {
  test('a visitor needs no account', () => {
    assert({
      given: 'an anonymous viewer, for a public Round, a private one and none',
      should: 'watch the public one and answer unavailable for the others',
      actual: [
        decideSpectate(round(), nobody),
        decideSpectate(round({ visibility: 'private' }), nobody),
        decideSpectate(null, nobody),
      ],
      expected: ['watch', 'unavailable', 'unavailable'],
    });
  });

  test('missing and private Rounds are one answer', () => {
    assert({
      given: 'a signed-in viewer and a missing or private Round',
      should: 'answer unavailable for both',
      actual: [
        decideSpectate(null, member('x')),
        decideSpectate(round({ visibility: 'private' }), member('x')),
      ],
      expected: ['unavailable', 'unavailable'],
    });
  });

  test('participants do not spectate their own Round', () => {
    assert({
      given: 'a debater and a judge of an unlisted Round',
      should: 'answer conflict for both',
      actual: [
        decideSpectate(round({ visibility: 'unlisted' }), member('aff')),
        decideSpectate(round(), member('judge')),
      ],
      expected: ['conflict', 'conflict'],
    });
  });

  test('a removed spectator', () => {
    assert({
      given: 'a viewer the host removed',
      should: 'answer revoked',
      actual: decideSpectate(round({ removedSpectators: ['x'] }), member('x')),
      expected: 'revoked',
    });
  });

  test('upcoming, full and watchable Rounds', () => {
    assert({
      given: 'an upcoming Round, a full live one, a live one and an ended one',
      should: 'answer upcoming, full, watch and watch',
      actual: [
        decideSpectate(
          round({
            state: { status: 'upcoming', affReady: true, negReady: false },
          }),
          member('x'),
        ),
        decideSpectate(round({ audienceFull: true }), member('x')),
        decideSpectate(round(), member('x')),
        decideSpectate(
          round({
            audienceFull: true,
            state: {
              status: 'ended',
              ballots: { state: 'pending', received: 0, of: 3 },
              recording: {
                endedAt: '2026-09-30T00:00:00.000Z',
                lengthSeconds: 60,
                availability: 'ready',
                keptUntil: null,
              },
            },
          }),
          member('x'),
        ),
      ],
      expected: ['upcoming', 'full', 'watch', 'watch'],
    });
  });
});
