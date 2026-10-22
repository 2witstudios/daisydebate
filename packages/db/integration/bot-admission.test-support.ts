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
