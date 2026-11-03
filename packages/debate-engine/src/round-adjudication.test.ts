import { assertRejects } from '@daisy/errors/testing';
import { attendanceTimingPolicy } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  emptyCheckpoint,
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();
const opened = () => {
  const rules = oneOnOneRules();
  const first = rules.segments[0]!;
  return runtimeWorld({
    status: 'active',
    rules,
    segments: [
      {
        id: 'actual-speech',
        sequence: 0,
        type: first.type,
        rulesSegmentKey: first.key,
        startedAt: roundAt(10_000),
        endedAt: null,
        durationMs: first.durationMs,
      },
    ],
  });
};
const decision = {
  evidence: 'settled_availability' as const,
  decision: 'forfeit' as const,
  winner: 'negative' as const,
  effectiveDeadlineMs: Date.parse(roundAt(50_000)),
};

test('verified attendance forfeit uses actual speech authority and closes the actual played interval', () => {
  const world = opened();
  const projection = world.adjudicate({
    segmentId: 'actual-speech',
    decision,
    now: roundAt(55_000),
  });
  assert({
    given: 'the settled absence of the actual affirmative speech seat',
    should:
      'complete through the shared runtime with actual final-end and speaking closure',
    actual: {
      status: projection.round?.status,
      outcome: projection.round?.outcome,
      final: projection.finalSegmentEndedAt,
      closes: projection.segmentCloses,
    },
    expected: {
      status: 'completed',
      outcome: 'negative',
      final: roundAt(55_000),
      closes: [{ id: 'actual-speech', endedAt: roundAt(55_000) }],
    },
  });
});
test('both absent abandons without inventing a winner', () => {
  const world = opened();
  const projection = world.adjudicate({
    segmentId: 'actual-speech',
    decision: {
      decision: 'abandoned',
      effectiveDeadlineMs: decision.effectiveDeadlineMs,
    },
    now: roundAt(55_000),
  });
  assert({
    given: 'a settled both-absent decision',
    should:
      'abandon the same runtime and close its actual interval without outcome',
    actual: [
      projection.round?.status,
      projection.round?.outcome,
      projection.finalSegmentEndedAt,
    ],
    expected: ['abandoned', null, roundAt(55_000)],
  });
});
test('historical speech absence remains tied to its speaker after another seat holds a later floor', () => {
  const rules = oneOnOneRules();
  const holderId = 'n'.repeat(24);
  const world = runtimeWorld({
    status: 'active',
    rules,
    participants: oneOnOneSeats.map((seat, index) =>
      index === 1 ? { ...seat, id: holderId } : seat,
    ),
    checkpoint: {
      ...emptyCheckpoint,
      floor: {
        holder_participant_id: holderId,
        granted_at: roundAt(330_000),
      },
    },
    segments: rules.segments.slice(0, 2).map((s, index) => ({
      id: index === 0 ? 'actual-speech' : 'later-cx',
      sequence: index,
      type: s.type,
      rulesSegmentKey: s.key,
      startedAt: roundAt(index === 0 ? 10_000 : 320_000),
      endedAt: index === 0 ? roundAt(310_000) : null,
      durationMs: s.durationMs,
    })),
  });
  const projection = world.adjudicate({
    segmentId: 'actual-speech',
    decision,
    now: roundAt(375_000),
  });
  assert({
    given:
      'an earlier affirmative attendance failure while negative holds a later CX floor',
    should:
      'forfeit the historical affirmative speaker and close the actual later interval',
    actual: [
      projection.round?.outcome,
      projection.finalSegmentEndedAt,
      projection.segmentCloses,
    ],
    expected: [
      'negative',
      roundAt(375_000),
      [{ id: 'later-cx', endedAt: roundAt(375_000) }],
    ],
  });
});
test('a settled absence still forfeits after the debate is over', () => {
  const rules = oneOnOneRules();
  const world = runtimeWorld({
    status: 'active',
    rules,
    segments: rules.segments.map((s, index) => ({
      id: index === 0 ? 'actual-speech' : `later-${index}`,
      sequence: index,
      type: s.type,
      rulesSegmentKey: s.key,
      startedAt: roundAt(10_000 + index * 1_000),
      endedAt: roundAt(10_500 + index * 1_000),
      durationMs: s.durationMs,
    })),
  });
  const projection = world.adjudicate({
    segmentId: 'actual-speech',
    decision,
    now: roundAt(55_000),
  });
  assert({
    given: 'an attendance decision that settles after the final segment closed',
    should: 'still forfeit the absent speaker, unlike a debater leaving',
    actual: [projection.round?.status, projection.round?.outcome],
    expected: ['completed', 'negative'],
  });
});
test('early, foreign, wrong-side and final-speech attendance decisions refuse atomically', async () => {
  const world = opened();
  const before = world.position(roundAt(55_000));
  for (const input of [
    { segmentId: 'actual-speech', decision, now: roundAt(54_999) },
    { segmentId: 'foreign', decision, now: roundAt(55_000) },
    {
      segmentId: 'actual-speech',
      decision: { ...decision, winner: 'affirmative' as const },
      now: roundAt(55_000),
    },
  ])
    await assertRejects({
      given: 'an unverified timing, target or winner',
      should: 'refuse the attendance mutation',
      actual: () => world.adjudicate(input),
      code: 'INVARIANT',
    });
  assert({
    given: 'all refused adjudications',
    should: 'leave the hydrated runtime unchanged',
    actual: world.position(roundAt(55_000)),
    expected: before,
  });
  const rules = oneOnOneRules();
  const last = rules.segments.filter((s) => s.type === 'speech').at(-1)!;
  const sequence = rules.segments.indexOf(last);
  const final = runtimeWorld({
    status: 'active',
    rules,
    segments: rules.segments
      .map((s, i) => ({
        id: i === sequence ? 'final-speech' : `past-${i}`,
        sequence: i,
        type: s.type,
        rulesSegmentKey: s.key,
        startedAt: roundAt(i * 400_000),
        endedAt: i === sequence ? null : roundAt(i * 400_000 + s.durationMs),
        durationMs: s.durationMs,
      }))
      .filter((s) => s.sequence <= sequence),
  });
  await assertRejects({
    given: 'the final speech excluded by policy',
    should: 'never adjudicate attendance against it',
    actual: () =>
      final.adjudicate({
        segmentId: 'final-speech',
        decision,
        now: roundAt(sequence * 400_000 + 55_000),
      }),
    code: 'INVARIANT',
  });
});

describe('a decision past the resolution cutoff', () => {
  const rules = oneOnOneRules();
  const finalEndAt = 4_000_000;
  const played = () =>
    runtimeWorld({
      status: 'active',
      rules,
      segments: rules.segments.map((s, i) => ({
        id: `row-${i}`,
        sequence: i,
        type: s.type,
        rulesSegmentKey: s.key,
        startedAt: roundAt(i * 400_000),
        endedAt: roundAt(
          i === rules.segments.length - 1 ? finalEndAt : (i + 1) * 400_000,
        ),
        durationMs: s.durationMs,
      })),
    });
  const cutoffAtMs =
    Date.parse(roundAt(finalEndAt)) + attendanceTimingPolicy.resolutionCutoffMs;
  const ended = (
    world: ReturnType<typeof played>,
    atMs: number,
    nowMs: number,
  ) =>
    world.adjudicate({
      segmentId: 'row-0',
      decision: {
        evidence: 'resolution_cutoff',
        decision: 'abandoned',
        cutoffAtMs: atMs,
      },
      now: new Date(nowMs).toISOString(),
    });

  test('a Round abandons at the debate end plus the policy', () => {
    assert({
      given: 'a closed last segment and its true cutoff, passed',
      should: 'abandon the Round with no winner',
      actual: ended(played(), cutoffAtMs, cutoffAtMs).round?.status,
      expected: 'abandoned',
    });
  });

  test('a caller cannot end a Round on a cutoff of its own', async () => {
    const world = played();
    const before = world.position(roundAt(finalEndAt));
    for (const [given, atMs, nowMs] of [
      ['a cutoff earlier than the true one', 0, cutoffAtMs],
      [
        'a cutoff later than the true one',
        played,
        cutoffAtMs + 1,
        cutoffAtMs + 1,
      ],
      ['a true cutoff not yet passed', cutoffAtMs, cutoffAtMs - 1],
    ] as const)
      await assertRejects({
        given,
        should: 'refuse the abandonment',
        actual: () => ended(world, atMs, nowMs),
        code: 'INVARIANT',
      });
    await assertRejects({
      given: 'a Round mid-speech, with no closed end',
      should: 'refuse the abandonment',
      actual: () => ended(opened(), cutoffAtMs, cutoffAtMs),
      code: 'INVARIANT',
    });
    assert({
      given: 'all refused abandonments',
      should: 'leave the hydrated runtime unchanged',
      actual: world.position(roundAt(finalEndAt)),
      expected: before,
    });
  });
});
