import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { broadcastPhase, type PhasePosition } from './broadcast-phase';

setupRitewayBun();

const base: PhasePosition = {
  status: 'active',
  openSegment: null,
  nextSegment: null,
  prep: null,
  stage: 'countdown',
};
const speechNext = { type: 'speech' } as const;

describe('broadcastPhase', () => {
  test('only the last segment leads to a private phase', () => {
    const endsAt = '2026-11-02T00:01:00.000Z';
    assert({
      given: 'a speech with others after it, as the runtime reports it',
      should: 'stay public: its nextSegment is null only because it is open',
      actual: broadcastPhase(
        { ...base, openSegment: { type: 'speech', endsAt, sequence: 2 } },
        6,
      ),
      expected: { kind: 'public' },
    });
    assert({
      given: 'the last speech ending at a known time',
      should:
        'report the private phase at that time, so revocation can lead it',
      actual: broadcastPhase(
        { ...base, openSegment: { type: 'speech', endsAt, sequence: 6 } },
        6,
      ),
      expected: { kind: 'private-at', atMs: Date.parse(endsAt) },
    });
  });
  test('prep, the wait for a ballot and before the first segment are private', () => {
    assert({
      given: 'prep, awaiting a ballot, and an opening Round',
      should: 'be private in each',
      actual: [
        broadcastPhase({ ...base, prep: { side: 'affirmative' } }, 6),
        broadcastPhase({ ...base, stage: 'awaiting_ballot' }, 6),
        broadcastPhase(
          { ...base, status: 'opening', nextSegment: speechNext },
          6,
        ),
      ],
      expected: [{ kind: 'private' }, { kind: 'private' }, { kind: 'private' }],
    });
  });
  test('between two speeches is public, and an unknown state fails closed', () => {
    assert({
      given: 'a live Round between segments with one next, and with none',
      should: 'be public only when a segment is known to follow',
      actual: [
        broadcastPhase({ ...base, nextSegment: speechNext }, 6),
        broadcastPhase(base, 6),
      ],
      expected: [{ kind: 'public' }, { kind: 'private' }],
    });
  });
  test('what is not declared public is private, a future incident pause included', () => {
    const endsAt = '2026-11-02T00:01:00.000Z';
    assert({
      given:
        'no stage, a stage nothing declares, a name off Object, and an undeclared segment type',
      should: 'be private in each',
      actual: [
        broadcastPhase({ ...base, stage: null, nextSegment: speechNext }, 6),
        broadcastPhase(
          { ...base, stage: 'incident_pause', nextSegment: speechNext },
          6,
        ),
        broadcastPhase(
          { ...base, stage: 'constructor', nextSegment: speechNext },
          6,
        ),
        broadcastPhase(
          {
            ...base,
            stage: 'live',
            openSegment: { type: 'incident_pause', endsAt, sequence: 1 },
          },
          6,
        ),
      ],
      expected: [
        { kind: 'private' },
        { kind: 'private' },
        { kind: 'private' },
        { kind: 'private' },
      ],
    });
  });
});
