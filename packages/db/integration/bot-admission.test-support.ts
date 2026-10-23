import { createId } from '@paralleldrive/cuid2';
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

/** A bounded run with two Rounds one verified member created, and actual admission under a busy cap of four. */
export const withSponsoredAdmission = (
  work: (input: {
    readonly fixture: Fixture;
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
    await work({ fixture, firstRound, secondRound, actorId, admission });
  });
