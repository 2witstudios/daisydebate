import { assertRejects } from '@daisy/errors/testing';
import type { RoundProjection } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  requireCompletionProjection,
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
const receipt = unjudgedReceipt({
  commandId: ids.commandId,
  roundId: ids.roundId,
  freezeRevision: 2,
  resultingVersion: 9,
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
  result: receipt,
  resultingVersion: 9,
  appliedAt: new Date('2026-10-22T12:00:00.000Z'),
  ...overrides,
});
type Round = Parameters<typeof requireUnjudgedRound>[0];
const round = (overrides: Record<string, unknown> = {}): Round =>
  ({
    competitionType: 'casual',
    rules: { seats: { judge: 0 } },
    segments: [{ endedAt: '2026-10-22T12:00:00.000Z' }],
    participants: [{ role: 'affirmative' }, { role: 'negative' }],
    ...overrides,
  }) as unknown as Round;
const durable = {
  ladder_id: null,
  final_segment_ended_at: '2026-10-22T12:00:00.000Z',
  transcript_admission_cutoff: '2026-10-22T12:00:02.000Z',
  ballots: false,
  ratings: false,
};
const facts = (
  overrides: Partial<Parameters<typeof requireUnjudgedFacts>[0]>,
) =>
  requireUnjudgedFacts({
    freezeRevision: 2,
    freeze: { revision: 2 },
    seats: [{ eligible: true }, { eligible: true }],
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
      commandRow({ result: { ...receipt, freezeRevision: 3 } }),
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

test('a replay stands only while the Round is completed without a winner', async () => {
  for (const state of [
    { status: 'active', outcome: null },
    { status: 'completed', outcome: 'affirmative' },
    { status: 'abandoned', outcome: null },
  ])
    await assertRejects({
      given: `a Round now ${state.status} with outcome ${state.outcome}`,
      should: 'refuse the replayed unjudged receipt',
      actual: () => requireUnjudgedTerminal(state),
      code: 'CONFLICT',
    });
  assert({
    given: 'a completed Round with no outcome',
    should: 'admit the replay',
    actual: requireUnjudgedTerminal({ status: 'completed', outcome: null }),
    expected: undefined,
  });
});

test('only a played casual Round without judges is eligible', async () => {
  for (const [label, candidate] of [
    ['a missing Round', null],
    ['a ranked Round', round({ competitionType: 'ranked' })],
    ['a practice Round', round({ competitionType: 'practice' })],
    ['required judges', round({ rules: { seats: { judge: 1 } } })],
    ['an unfinished segment', round({ segments: [{ endedAt: null }] })],
    [
      'a judge seat',
      round({ participants: [{ role: 'affirmative' }, { role: 'judge' }] }),
    ],
  ] as const)
    await assertRejects({
      given: `${label}`,
      should: 'refuse unjudged completion as ineligible',
      actual: () => requireUnjudgedRound(candidate as Round),
      code: 'CONFLICT',
    });
  assert({
    given: 'a played casual Round with zero required judges and no judge seat',
    should: 'admit it',
    actual: requireUnjudgedRound(round()),
    expected: undefined,
  });
});

test('durable facts must show the frozen revision and no competitive record', async () => {
  for (const [label, overrides] of [
    ['no freeze', { freeze: null }],
    ['another freeze revision', { freeze: { revision: 3 } }],
    [
      'an ineligible seat',
      { seats: [{ eligible: true }, { eligible: false }] },
    ],
    ['no durable Round row', { durable: undefined }],
    ['a ladder', { durable: { ...durable, ladder_id: 'ladder' } }],
    ['no final end', { durable: { ...durable, final_segment_ended_at: null } }],
    [
      'no admission cutoff',
      { durable: { ...durable, transcript_admission_cutoff: null } },
    ],
    ['a ballot', { durable: { ...durable, ballots: true } }],
    ['a rating change', { durable: { ...durable, ratings: true } }],
  ] as const)
    await assertRejects({
      given: `${label}`,
      should: 'refuse unjudged completion as ineligible',
      actual: () => facts(overrides),
      code: 'CONFLICT',
    });
  assert({
    given: 'the requested freeze, eligible seats and a clean casual Round',
    should: 'return the freeze',
    actual: facts({}),
    expected: { revision: 2 },
  });
});

test('the engine completion must finish without a winner or segment change', async () => {
  const completed = {
    round: { status: 'completed', outcome: null },
    segmentInserts: [],
    segmentCloses: [],
  } as unknown as RoundProjection;
  for (const [label, projection] of [
    ['an active Round', { ...completed, round: { status: 'active' } }],
    ['no Round change', { ...completed, round: undefined }],
    [
      'a winner',
      { ...completed, round: { status: 'completed', outcome: 'negative' } },
    ],
    ['a segment insert', { ...completed, segmentInserts: [{}] }],
    ['a segment close', { ...completed, segmentCloses: [{}] }],
  ] as const)
    await assertRejects({
      given: `a completion projection with ${label}`,
      should: 'refuse it as an invalid unjudged projection',
      actual: () =>
        requireCompletionProjection(projection as unknown as RoundProjection),
      code: 'CONFLICT',
    });
  assert({
    given: 'a completed projection with no outcome and no segment writes',
    should: 'admit it',
    actual: requireCompletionProjection(completed),
    expected: undefined,
  });
});

test('a new receipt is a completed, unreplayed, winnerless version 1 record', () => {
  assert({
    given: 'the command, Round, revision and resulting version',
    should: 'build the strict protocol receipt',
    actual: receipt,
    expected: {
      version: 1,
      commandId: ids.commandId,
      roundId: ids.roundId,
      freezeRevision: 2,
      resultingVersion: 9,
      status: 'completed',
      outcome: null,
      replayed: false,
    },
  });
});
