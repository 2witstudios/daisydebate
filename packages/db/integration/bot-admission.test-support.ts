import { createId } from '@paralleldrive/cuid2';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { createRoundBotAdmission } from '../src/round-bot-admission';
import { withBoundedRound } from './bounded-transaction.test-support';
import type { Fixture } from './constraint-helpers';
export async function admissionSponsor(
  fixture: Fixture,
  roundIds: readonly string[],
) {
  const user = await fixture.user();
  await fixture.sql`update users set email_verified=true where id=${user}`;
  const actorId = await fixture.actor(user);
  for (const roundId of roundIds)
    await fixture.sql`update rounds set created_by_actor_id=${actorId} where id=${roundId}`;
  return actorId;
}

/** Two Rounds hosted by one sponsoring member, with real admission at busy cap 4. */
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
    const admission = createRoundBotAdmission({
      run,
      nextId: createId,
      busyCap: 4,
    });
    await work({ fixture, run, firstRound, secondRound, actorId, admission });
  });
