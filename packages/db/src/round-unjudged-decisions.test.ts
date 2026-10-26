import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  recordedUnjudgedRuling,
  requireUnjudgedFacts,
  requireUnjudgedRequest,
  requireUnjudgedRound,
  requireUnjudgedTerminal,
  unjudgedDigest,
  unjudgedReceipt,
  validateUnjudgedReceipt,
} from './round-unjudged-decisions';

setupRitewayBun();

const ids = {
  instanceId: 'instancea1b2c3d4e5f6g7h8',
  commandId: 'commandaa1b2c3d4e5f6g7h8',
  roundId: 'roundaaaa1b2c3d4e5f6g7h8',
};
const request = { ...ids, freezeRevision: 2 };
const digest = unjudgedDigest(request);
const judgeSeat = 'judgeaaaa1b2c3d4e5f6g7h8';
const receipt = unjudgedReceipt({
  commandId: ids.commandId,
  roundId: ids.roundId,
  freezeRevision: 2,
  resultingVersion: 9,
  ruling: 'judges-did-not-rule',
  outcome: null,
  noRuling: [judgeSeat],
});
const commandRow = (
  overrides: Partial<Parameters<typeof validateUnjudgedReceipt>[0]> = {},
): Parameters<typeof validateUnjudgedReceipt>[0] => ({
  commandId: ids.commandId,
  roundId: ids.roundId,
  actorId: null,
  serviceId: `round-finalization:${ids.instanceId}`,
  type: 'complete',
  payloadDigest: digest,
  result: { ...receipt, noRuling: [...receipt.noRuling] },
  resultingVersion: 9,
  appliedAt: new Date('2026-10-22T12:00:00.000Z'),
  ...overrides,
});
type Round = Parameters<typeof requireUnjudgedRound>[0];
const round = (overrides: Record<string, unknown> = {}): Round =>
  ({
    competitionType: 'casual',
    segments: [{ endedAt: '2026-10-22T12:00:00.000Z' }],
    participants: [{ role: 'affirmative' }, { role: 'negative' }],
    ...overrides,
  }) as unknown as Round;
const durable = {
  ladder_id: null,
  final_segment_ended_at: '2026-10-22T12:00:00.000Z',
  transcript_admission_cutoff: '2026-10-22T12:00:02.000Z',
  ballot_deadline_at: '2026-10-22T12:05:00.000Z',
  ratings: false,
};
const facts = (
  overrides: Partial<Parameters<typeof requireUnjudgedFacts>[0]>,
) =>
  requireUnjudgedFacts({
    freezeRevision: 2,
    freeze: { revision: 2 },
    seats: [
      { role: 'affirmative', eligible: true },
      { role: 'negative', eligible: true },
      { role: 'judge', eligible: false },
    ],
    durable,
    ...overrides,
  });

test('requests need cuid2 identities and a positive integer freeze revision', async () => {
  for (const invalid of [
    { ...request, roundId: 'not a cuid' },
    { ...request, commandId: '' },
    { ...request, freezeRevision: 0 },
    { ...request, freezeRevision: 1.5 },
  ])
    await assertRejects({
      given: `an unjudged request ${JSON.stringify(invalid)}`,
      should: 'refuse it as invalid input',
      actual: () => requireUnjudgedRequest(invalid),
      code: 'VALIDATION',
    });
  assert({
    given: 'a well-formed request',
    should: 'admit it',
    actual: requireUnjudgedRequest(request),
    expected: undefined,
  });
});

test('the command digest binds the Round and frozen revision only', () => {
  assert({
    given:
      'the same Round and revision from another service instance or command',
    should:
      'produce the same digest, while another revision produces a different one',
    actual: [
      unjudgedDigest({
        ...request,
        instanceId: 'otherinsta1b2c3d4e5f6g7h8',
      }) === digest,
      unjudgedDigest({ ...request, commandId: 'othercomm1b2c3d4e5f6g7h8' }) ===
        digest,
      unjudgedDigest({ ...request, freezeRevision: 3 }) === digest,
      /^[0-9a-f]{64}$/.test(digest),
    ],
    expected: [true, true, false, true],
  });
});

test('only this service exact zero-judge receipt replays', async () => {
  assert({
    given: 'the stored receipt for this command, Round and revision',
    should: 'return the parsed receipt',
    actual: validateUnjudgedReceipt(commandRow(), request, digest),
    expected: receipt,
  });
  for (const [label, row] of [
    ['another Round', commandRow({ roundId: 'otherroun1b2c3d4e5f6g7h8' })],
    ['another command type', commandRow({ type: 'abandon' })],
    ['an actor principal', commandRow({ actorId: 'actoraaaa1b2c3d4e5f6g7h8' })],
    ['another service', commandRow({ serviceId: 'round-runtime:x' })],
    ['no service', commandRow({ serviceId: null })],
    ['another payload digest', commandRow({ payloadDigest: 'f'.repeat(64) })],
    [
      'a receipt for another revision',
      commandRow({
        result: {
          ...receipt,
          noRuling: [...receipt.noRuling],
          freezeRevision: 3,
        },
      }),
    ],
    [
      'a receipt for another command',
      commandRow({ commandId: 'othercomm1b2c3d4e5f6g7h8' }),
    ],
    ['a receipt version mismatch', commandRow({ resultingVersion: 10 })],
  ] as const)
    await assertRejects({
      given: `a stored completion with ${label}`,
      should: 'refuse replay as a receipt conflict',
      actual: () => validateUnjudgedReceipt(row, request, digest),
      code: 'CONFLICT',
    });
});

test('a replay stands only while the Round is completed with the receipt outcome', async () => {
  for (const [state, recorded] of [
    [{ status: 'active', outcome: null }, null],
    [{ status: 'completed', outcome: 'affirmative' }, null],
    [{ status: 'completed', outcome: null }, 'negative'],
    [{ status: 'abandoned', outcome: null }, null],
  ] as const)
    await assertRejects({
      given: `a Round now ${state.status} with outcome ${state.outcome} against a receipt of ${recorded}`,
      should: 'refuse the replayed receipt',
      actual: () => requireUnjudgedTerminal(state, recorded),
      code: 'CONFLICT',
    });
  assert({
    given: 'completed Rounds whose outcome matches the receipt',
    should: 'admit the replay',
    actual: [
      requireUnjudgedTerminal({ status: 'completed', outcome: null }, null),
      requireUnjudgedTerminal(
        { status: 'completed', outcome: 'negative' },
        'negative',
      ),
    ],
    expected: [undefined, undefined],
  });
});

test('only a fully played casual Round is eligible, judged or not', async () => {
  for (const [label, candidate] of [
    ['a missing Round', null],
    ['a ranked Round', round({ competitionType: 'ranked' })],
    ['an unfinished segment', round({ segments: [{ endedAt: null }] })],
  ] as const)
    await assertRejects({
      given: `${label}`,
      should: 'refuse deadline completion as ineligible',
      actual: () => requireUnjudgedRound(candidate as Round),
      code: 'CONFLICT',
    });
  assert({
    given: 'a played casual Round without judges, and one with a judge seat',
    should: 'admit both',
    actual: [
      requireUnjudgedRound(round()),
      requireUnjudgedRound(
        round({ participants: [{ role: 'affirmative' }, { role: 'judge' }] }),
      ),
    ],
    expected: [undefined, undefined],
  });
});

test('durable facts must show the frozen revision, eligible debaters and no ladder or rating', async () => {
  for (const [label, overrides] of [
    ['no freeze', { freeze: null }],
    ['another freeze revision', { freeze: { revision: 3 } }],
    [
      'an ineligible debater',
      {
        seats: [
          { role: 'affirmative', eligible: true },
          { role: 'negative', eligible: false },
        ],
      },
    ],
    ['no durable Round row', { durable: undefined }],
    ['a ladder', { durable: { ...durable, ladder_id: 'ladder' } }],
    ['no final end', { durable: { ...durable, final_segment_ended_at: null } }],
    [
      'no admission cutoff',
      { durable: { ...durable, transcript_admission_cutoff: null } },
    ],
    ['a rating change', { durable: { ...durable, ratings: true } }],
  ] as const)
    await assertRejects({
      given: `${label}`,
      should: 'refuse unjudged completion as ineligible',
      actual: () => facts(overrides),
      code: 'CONFLICT',
    });
  assert({
    given:
      'the requested freeze, eligible debaters beside a judge who left, and a clean casual Round',
    should: 'return the freeze and the persisted ballot deadline',
    actual: [
      facts({}),
      facts({ durable: { ...durable, ballot_deadline_at: null } })
        .ballotDeadlineAt,
    ],
    expected: [
      {
        freeze: { revision: 2 },
        ballotDeadlineAt: '2026-10-22T12:05:00.000Z',
      },
      null,
    ],
  });
});

test('a new receipt is a completed, unreplayed version 1 record of the ruling', () => {
  assert({
    given: 'the command, Round, revision, version and a no-ruling outcome',
    should: 'build the strict protocol receipt',
    actual: receipt,
    expected: {
      version: 1,
      commandId: ids.commandId,
      roundId: ids.roundId,
      freezeRevision: 2,
      resultingVersion: 9,
      status: 'completed',
      ruling: 'judges-did-not-rule',
      outcome: null,
      noRuling: [judgeSeat],
      replayed: false,
    },
  });
});

test('the Round view reads the ruling only from this service unjudged receipt (DEC-208)', () => {
  const incomplete = {
    ...receipt,
    ruling: 'transcript-incomplete' as const,
    noRuling: [...receipt.noRuling],
  };
  assert({
    given:
      'the service receipt, an actor completion, another service, a non-receipt result and no rows',
    should: 'return the receipt ruling only for this service receipt',
    actual: [
      recordedUnjudgedRuling([commandRow({ result: incomplete })]),
      recordedUnjudgedRuling([
        commandRow({ actorId: 'actoraaaa1b2c3d4e5f6g7h8', serviceId: null }),
      ]),
      recordedUnjudgedRuling([commandRow({ serviceId: 'attendance:x' })]),
      recordedUnjudgedRuling([commandRow({ result: { status: 'completed' } })]),
      recordedUnjudgedRuling([]),
    ],
    expected: ['transcript-incomplete', null, null, null, null],
  });
});
