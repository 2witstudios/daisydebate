import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type {
  AttendanceEvaluationFacts,
  AttendanceEvaluator,
  AttendanceStore,
} from '@daisy/db/attendance';
import {
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  attendanceTimingPolicy,
  emptyRuntimeCheckpoint,
} from '@daisy/protocol';
import { createAttendanceFeature } from './operations';
setupRitewayBun();

const compiled = resolveRoomConfiguration(oneOnOneDefinition, oneOnOneSettings);
if (!compiled.ok) throw new Error('Canonical rules fixture refused');
const rules = compiled.rules;
const firstSpeech = rules.segments.find((s) => s.type === 'speech')!;
const openedAtMs = Date.parse('2026-10-22T00:02:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const segment = {
  id: 'actual-first',
  sequence: 0,
  type: 'speech' as const,
  rulesSegmentKey: firstSpeech.key,
  startedAt: iso(openedAtMs),
  endedAt: null,
  durationMs: firstSpeech.durationMs,
  returnedMs: 0,
};
const speaker = firstSpeech.side === 'affirmative' ? 'aff' : 'neg';
const opponent = speaker === 'aff' ? 'neg' : 'aff';
const participants = [
  { id: 'aff', actorId: 'actor-aff', role: 'affirmative' as const, slot: 0 },
  { id: 'neg', actorId: 'actor-neg', role: 'negative' as const, slot: 0 },
];
const healthyThrough = (lastMs: number) =>
  Array.from({ length: (lastMs - openedAtMs) / 1000 + 2 }, (_, n) => ({
    at: iso(openedAtMs + (n - 1) * 1000),
    healthy: true,
    cause: null,
  }));
const facts = (
  overrides: Partial<AttendanceEvaluationFacts> = {},
): AttendanceEvaluationFacts =>
  ({
    round: {
      id: 'round',
      status: 'active',
      currentStage: 'live',
      version: 1,
      startedAt: iso(openedAtMs - rules.countdownMs),
      completedAt: null,
      outcome: null,
      rules,
      participants,
      checkpoint: emptyRuntimeCheckpoint,
      segments: [segment],
    },
    eligibleParticipantIds: ['aff', 'neg'],
    samples: healthyThrough(openedAtMs + 50000),
    finalizedSegmentIds: [],
    now: iso(openedAtMs + 50000),
    checkIns: [],
    botSeatIds: [],
    ...overrides,
  }) as unknown as AttendanceEvaluationFacts;
const stamp = (participantId: string) => ({
  participantId,
  segmentId: segment.id,
  receivedAt: iso(openedAtMs + 1000),
});

function feature(read: Partial<AttendanceEvaluationFacts> = {}) {
  const recorded: unknown[] = [];
  let ids = 0;
  const instance = createAttendanceFeature({
    checkIns: {
      readRoundAttendanceTargets: async () => ({
        ...facts(read),
        receipts: (read as { receipts?: unknown[] }).receipts ?? [],
      }),
      recordRoundCheckIn: async (input: unknown) => {
        recorded.push(input);
        return { recorded: true };
      },
    } as unknown as AttendanceStore,
    evaluate: (async (input: {
      readonly resolveOnReceipts: (f: AttendanceEvaluationFacts) => unknown;
      readonly resolve: (f: AttendanceEvaluationFacts) => unknown;
    }) => {
      const resolution =
        input.resolveOnReceipts(facts(read)) ?? input.resolve(facts(read));
      return resolution
        ? { kind: 'decided', resolution }
        : { kind: 'undecided' };
    }) as unknown as AttendanceEvaluator,
    nextId: () => `command${String(++ids).padStart(17, '0')}`,
    instanceId: 'instance0000000000000000',
  });
  return {
    instance: {
      ...instance,
      /** The resolution a pass reached, or null while it stays undecided. */
      evaluate: async (roundId: string) => {
        const found = await instance.evaluate(roundId);
        return found.kind === 'decided' ? found.resolution : null;
      },
    },
    recorded,
  };
}
const principal = { kind: 'human' as const, actorId: 'actor-aff' };

test('evaluation resolves only settled actual-speech evidence', async () => {
  assert({
    given: 'the scheduled speaker checked in on time',
    should: 'credit the receipt without a competitive projection',
    actual: await feature({ checkIns: [stamp(speaker)] }).instance.evaluate(
      'round',
    ),
    expected: {
      segmentId: segment.id,
      evidence: 'on_time_receipt',
      decision: 'attended',
      receiptParticipantId: speaker,
      projection: null,
    },
  });
  for (const [given, read] of [
    [
      'availability settled only before deadline plus buffer',
      { samples: healthyThrough(openedAtMs + 44000) },
    ],
    [
      'every adjudicable speech already finalized',
      { finalizedSegmentIds: [segment.id] },
    ],
  ] as const)
    assert({
      given,
      should: 'postpone without a decision',
      actual: await feature(read).instance.evaluate('round'),
      expected: null,
    });
});

test('an on-time speaker is credited when availability is broken or absent', async () => {
  for (const [given, samples] of [
    ['no samples at all', []],
    [
      'permanently unhealthy samples',
      healthyThrough(openedAtMs + 50000).map((sample) => ({
        ...sample,
        healthy: false,
        cause: 'public_probe_failed',
      })),
    ],
  ] as const)
    assert({
      given,
      should: 'credit the receipt',
      actual: (
        (await feature({
          samples: samples as never,
          checkIns: [stamp(speaker)],
        }).instance.evaluate('round')) as { evidence: string }
      ).evidence,
      expected: 'on_time_receipt',
    });
});

test('unknown health forfeits nobody, and the persisted cutoff ends the Round with no winner', async () => {
  const unhealthy = healthyThrough(openedAtMs + 50000).map((sample) => ({
    ...sample,
    healthy: false,
    cause: 'public_probe_failed' as const,
  }));
  const late = {
    participantId: speaker,
    segmentId: segment.id,
    receivedAt: iso(openedAtMs + 41000),
  };
  const absent = {
    samples: unhealthy,
    checkIns: [stamp(opponent)],
  };
  assert({
    given: 'a missing speaker, a present opponent and unknown health',
    should: 'postpone, never forfeit',
    actual: await feature(absent).instance.evaluate('round'),
    expected: null,
  });
  assert({
    given: 'a late speaker with unproven health before the cutoff (DEC-278)',
    should: 'postpone, never credit',
    actual: await feature({
      samples: unhealthy,
      checkIns: [late],
    }).instance.evaluate('round'),
    expected: null,
  });
  assert({
    given: 'no cutoff yet because the final speech has not ended',
    should: 'postpone',
    actual: await feature({
      ...absent,
      now: iso(openedAtMs + 9_000_000),
    }).instance.evaluate('round'),
    expected: null,
  });
  const finalEndMs = openedAtMs + rules.segments.length * 1000;
  const cutoffMs = finalEndMs + attendanceTimingPolicy.resolutionCutoffMs;
  const ended = (await feature({
    ...absent,
    round: {
      ...facts().round,
      // Every speech has closed: the Round awaits its ballot.
      currentStage: 'awaiting_ballot',
      segments: rules.segments.map((rule, sequence) => ({
        id: sequence === 0 ? segment.id : `played-${sequence}`,
        sequence,
        type: rule.type,
        rulesSegmentKey: rule.key,
        startedAt: iso(openedAtMs + sequence * 1000),
        endedAt: iso(openedAtMs + (sequence + 1) * 1000),
        durationMs: rule.durationMs,
        returnedMs: 0,
      })),
    },
    now: iso(cutoffMs),
  }).instance.evaluate('round')) as {
    evidence: string;
    decision: string;
    projection: { round: { status: string; outcome: unknown } };
  };
  assert({
    given: 'the same window at the cutoff (DEC-276)',
    should: 'abandon on the cutoff, with no winner',
    actual: {
      evidence: ended.evidence,
      decision: ended.decision,
      status: ended.projection.round.status,
      outcome: ended.projection.round.outcome ?? null,
    },
    expected: {
      evidence: 'resolution_cutoff',
      decision: 'abandoned',
      status: 'abandoned',
      outcome: null,
    },
  });
});

test('a missing bot speaker receipt abandons through the shared engine projection', async () => {
  const resolution = (await feature({
    checkIns: [stamp(opponent)],
    botSeatIds: [speaker],
  }).instance.evaluate('round')) as {
    decision: string;
    projection: { round: { status: string; outcome: string | null } | null };
  } | null;
  assert({
    given: 'an absent bot speaker and a present human opponent',
    should: 'abandon with a terminal engine projection instead of a forfeit',
    actual: [
      resolution?.decision,
      resolution?.projection.round?.status,
      resolution?.projection.round?.outcome,
    ],
    expected: ['abandoned', 'abandoned', null],
  });
});

test('targets expose only open unrecorded windows and native forms carry fresh commands', async () => {
  const open = { now: iso(openedAtMs + 10000) };
  assert({
    given: 'an open actual speech window',
    should: 'expose its exact opening and effective deadline',
    actual: await feature(open).instance.targets(principal, 'round'),
    expected: [
      {
        segmentId: segment.id,
        openedAt: segment.startedAt,
        effectiveDeadline: '2026-10-22T00:02:40.000000Z',
      },
    ],
  });
  for (const [given, read] of [
    ['a time before the opening lead', { now: iso(openedAtMs - 5001) }],
    ['a time after the effective deadline', { now: iso(openedAtMs + 40001) }],
    [
      'an already recorded receipt',
      { ...open, receipts: [{ segmentId: segment.id }] },
    ],
  ] as const)
    assert({
      given,
      should: 'expose no target',
      actual: await feature(read as never).instance.targets(principal, 'round'),
      expected: [],
    });
  assert({
    given: 'a native read of an open window',
    should: 'issue a fresh command id per target',
    actual: (
      await feature(open).instance.nativeState(principal, 'round')
    ).targets.map((target) => target.commandId),
    expected: ['command00000000000000001'],
  });
});

test('check-in validates the envelope and records a SHA3 digest of it', async () => {
  const { instance, recorded } = feature();
  await assertRejects({
    given: 'a malformed envelope',
    should: 'refuse before any store call',
    actual: () => instance.checkIn(principal, 'round', { version: 2 } as never),
    code: 'VALIDATION',
  });
  const envelope = {
    version: 1 as const,
    commandId: 'command00000000000000009',
    segmentId: 'segment00000000000000001',
  };
  await instance.checkIn(principal, 'round', envelope);
  const [input] = recorded as {
    envelope: unknown;
    payloadDigest: string;
  }[];
  assert({
    given: 'a valid envelope',
    should: 'record it with the digest of its parsed form',
    actual: [recorded.length, input!.envelope, input!.payloadDigest],
    expected: [
      1,
      envelope,
      new Bun.CryptoHasher('sha3-256')
        .update(JSON.stringify(envelope))
        .digest('hex'),
    ],
  });
});
