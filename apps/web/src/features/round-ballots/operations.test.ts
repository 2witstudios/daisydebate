import { assertRejects } from '@daisy/errors/testing';
import type { LockedRoundBallotInput } from '@daisy/db/round-ballot';
import type { RoundBallotEnvelope } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  judgeActorId,
  judgeSeatId,
  lockedRound,
} from '../round-runtime/locked-round.test-support';
import { ballotFormFixture } from './ballot-form.test-support';
import { ballotFields } from './fields';
import { createRoundBallotOperations } from './operations';

setupRitewayBun();

const parsed = ballotFields(ballotFormFixture(), true);
if (!parsed.ok) throw new Error('The ballot form fixture must parse');
const envelope: RoundBallotEnvelope = parsed.envelope;
const context = {
  ...lockedRound,
  runKind: null,
  frozen: null as never,
};
const judge = { kind: 'human' as const, actorId: judgeActorId };
const ballot = (winner: string, status = 'submitted') =>
  ({ judgeParticipantId: judgeSeatId, winner, status }) as never;

/** Captures the prepared locked input the store would execute. */
const prepare = async (
  principal: typeof judge,
  raw: RoundBallotEnvelope = envelope,
) => {
  let prepared: LockedRoundBallotInput | null = null;
  await createRoundBallotOperations({
    nextBallotId: () => 'b'.repeat(24),
    nextSegmentId: () => 's'.repeat(24),
    store: {
      executeRoundBallot: async (input) => {
        prepared = input;
        return null as never;
      },
    },
  }).submit(principal, lockedRound.round.id, raw);
  return prepared!;
};

test('a malformed ballot is refused before the store', async () => {
  await assertRejects({
    given: 'a ballot envelope without its rubric',
    should: 'refuse as invalid',
    actual: () => prepare(judge, { ...envelope, ballot: undefined } as never),
    code: 'VALIDATION',
  });
});

test('only the seated judge is authorized, under the envelope digest', async () => {
  const prepared = await prepare(judge);
  assert({
    given: 'the judge seat submitting',
    should: 'authorize and bind the SHA3 digest of the parsed envelope',
    actual: [
      prepared.authorize(context),
      prepared.payloadDigest,
      prepared.nextBallotId(),
    ],
    expected: [
      undefined,
      new Bun.CryptoHasher('sha3-256')
        .update(JSON.stringify(envelope))
        .digest('hex'),
      'b'.repeat(24),
    ],
  });
  const debater = await prepare({
    kind: 'human',
    actorId: lockedRound.authority.hostActorId!,
  });
  await assertRejects({
    given: 'a debater submitting for the judge seat',
    should: 'refuse authority',
    actual: async () => debater.authorize(context),
    code: 'AUTHORIZATION',
  });
});

test('completion waits for every judge and refuses an unstorable vote', async () => {
  const prepared = await prepare(judge);
  assert({
    given: 'no ballot yet from the only judge',
    should: 'leave the Round for later judges',
    actual: prepared.buildProjection({ ...context, ballots: [] }),
    expected: null,
  });
  for (const [label, row] of [
    ['a draw vote', ballot('draw')],
    ['a pending ballot', ballot('affirmative', 'pending')],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse as a broken invariant',
      actual: async () =>
        prepared.buildProjection({ ...context, ballots: [row] }),
      code: 'INVARIANT',
    });
});
