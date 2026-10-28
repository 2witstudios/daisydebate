import { createId } from '@paralleldrive/cuid2';
import { aiRoundAllowance } from '@daisy/auth/authorization';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { createRoundBotAdmission } from '../src/round-bot-admission';
import { createAuthorizationSubject } from './authorization.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
import type { Fixture } from './constraint-helpers';

/** The beta quota policy production composes, at the beta cap of 20 (ISSUE-646). */
export const betaAllowance = (monthlyCap = 20) => ({
  allowance: (
    account: Parameters<typeof aiRoundAllowance>[0],
    grants: Parameters<typeof aiRoundAllowance>[1],
  ) => aiRoundAllowance(account, grants, { monthlyCap }),
});

/** A canonical member, approved for the beta unless `beta` says otherwise, hosting `roundIds`. */
export async function admissionSponsor(
  fixture: Fixture,
  roundIds: readonly string[],
  beta: 'approved' | 'pending' = 'approved',
) {
  const { actorId } = await createAuthorizationSubject(fixture, beta);
  for (const roundId of roundIds)
    await fixture.sql`update rounds set created_by_actor_id=${actorId} where id=${roundId}`;
  return actorId;
}

/** Real admission at busy cap `busyCap` with the beta policy. */
export const testBotAdmission = (
  run: BoundedTransaction,
  busyCap = 4,
  monthlyCap = 20,
) =>
  createRoundBotAdmission({
    run,
    nextId: createId,
    busyCap,
    ...betaAllowance(monthlyCap),
  });

/** Two Rounds hosted by one approved sponsoring member, with real admission at busy cap 4. */
export const withTwoRoundAdmission = (
  work: (context: {
    readonly fixture: Fixture;
    readonly run: BoundedTransaction;
    readonly firstRound: string;
    readonly secondRound: string;
    readonly actorId: string;
    readonly admission: ReturnType<typeof createRoundBotAdmission>;
  }) => Promise<void>,
) =>
  withBoundedRound(async (fixture, run, firstRound) => {
    const secondRound = await fixture.round();
    const actorId = await admissionSponsor(fixture, [firstRound, secondRound]);
    const admission = testBotAdmission(run);
    await work({ fixture, run, firstRound, secondRound, actorId, admission });
  });
