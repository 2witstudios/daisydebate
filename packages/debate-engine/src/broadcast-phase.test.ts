import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { broadcastPhase, type PhasePosition } from './broadcast-phase';

setupRitewayBun();

const base: PhasePosition = {
  status: 'active',
  openSegment: null,
  nextSegment: null,
  prep: null,
  awaitingBallot: false,
};
const open = (endsAt: string) => ({ endsAt });
const speechNext = { type: 'speech' } as const;

describe('broadcastPhase', () => {
  test('an open segment is public', () => {
    assert({
      given: 'a speech with another speech next',
      should: 'stay public, since the next phase is public too',
      actual: broadcastPhase({
        ...base,
        openSegment: open('2026-11-02T00:01:00.000Z'),
        nextSegment: speechNext,
      }),
      expected: { kind: 'public' },
    });
  });
  test('the last speech announces the private phase at its scheduled end', () => {
    assert({
      given: 'the final speech ending at a known time',
      should:
        'report the private phase at that time, so revocation can lead it',
      actual: broadcastPhase({
        ...base,
        openSegment: open('2026-11-02T00:01:00.000Z'),
      }),
      expected: {
        kind: 'private-at',
        atMs: Date.parse('2026-11-02T00:01:00.000Z'),
      },
    });
  });
  test('prep, the wait for a ballot and before the first segment are private', () => {
    assert({
      given: 'prep, awaiting a ballot, and an opening Round',
      should: 'be private in each',
      actual: [
        broadcastPhase({ ...base, prep: { side: 'affirmative' } }),
        broadcastPhase({ ...base, awaitingBallot: true }),
        broadcastPhase({
          ...base,
          status: 'opening',
          nextSegment: speechNext,
        }),
      ],
      expected: [{ kind: 'private' }, { kind: 'private' }, { kind: 'private' }],
    });
  });
  test('between two speeches is public, and an unknown state fails closed', () => {
    assert({
      given: 'a live Round between segments with one next, and with none',
      should: 'be public only when a segment is known to follow',
      actual: [
        broadcastPhase({ ...base, nextSegment: speechNext }),
        broadcastPhase(base),
      ],
      expected: [{ kind: 'public' }, { kind: 'private' }],
    });
  });
});
