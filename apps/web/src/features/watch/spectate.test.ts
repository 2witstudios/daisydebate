import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { WatchDebate, WatchViewer } from './debate';
import { decideSpectate } from './spectate';

setupRitewayBun();

const seat = (handle: string) =>
  ({ handle, rating: 1500, standing: 'established' }) as const;

const debate = (over: Partial<WatchDebate> = {}): WatchDebate => ({
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
  rating: 1400,
});
const nobody: WatchViewer = { signedIn: false };

describe('decideSpectate', () => {
  test('signed out', () => {
    assert({
      given: 'an anonymous viewer, for a real debate and for a missing one',
      should: 'answer signed-out either way, revealing nothing',
      actual: [decideSpectate(debate(), nobody), decideSpectate(null, nobody)],
      expected: ['signed-out', 'signed-out'],
    });
  });

  test('missing and private debates are one answer', () => {
    assert({
      given: 'a signed-in viewer and a missing or private debate',
      should: 'answer unavailable for both',
      actual: [
        decideSpectate(null, member('x')),
        decideSpectate(debate({ visibility: 'private' }), member('x')),
      ],
      expected: ['unavailable', 'unavailable'],
    });
  });

  test('participants do not spectate their own debate', () => {
    assert({
      given: 'a debater and a judge of an unlisted debate',
      should: 'answer conflict for both',
      actual: [
        decideSpectate(debate({ visibility: 'unlisted' }), member('aff')),
        decideSpectate(debate(), member('judge')),
      ],
      expected: ['conflict', 'conflict'],
    });
  });

  test('a removed spectator', () => {
    assert({
      given: 'a viewer the host removed',
      should: 'answer revoked',
      actual: decideSpectate(debate({ removedSpectators: ['x'] }), member('x')),
      expected: 'revoked',
    });
  });

  test('upcoming, full and watchable debates', () => {
    assert({
      given: 'an upcoming debate, a full live one, a live one and an ended one',
      should: 'answer upcoming, full, watch and watch',
      actual: [
        decideSpectate(
          debate({
            state: { status: 'upcoming', affReady: true, negReady: false },
          }),
          member('x'),
        ),
        decideSpectate(debate({ audienceFull: true }), member('x')),
        decideSpectate(debate(), member('x')),
        decideSpectate(
          debate({
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
