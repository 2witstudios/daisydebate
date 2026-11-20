import { sql } from 'drizzle-orm';
import { rowsOf, query } from './raw-rows';
import type { Tx } from './tx';
import { z } from 'zod';

/**
 * A minor's linked adults (ADR 0150 §3, ADR 0158): an adult with an active
 * guardian link to them, and the owner and `school.roster.manage` staff of
 * each open school they belong to, through the registered SECURITY DEFINER
 * function `daisy_linked_adult_users`, the rule's one SQL statement. It reads
 * across tenants itself, so the caller's scope is never touched.
 */
export const readLinkedAdultUserIds = async (
  tx: Tx,
  minorUserId: string,
): Promise<readonly string[]> =>
  (
    await query(
      tx,
      z.object({ user_id: z.string() }),
      sql`select user_id from public.daisy_linked_adult_users(${minorUserId})`,
    )
  ).map((row) => row.user_id);

/**
 * A Youth Round's youth debaters and the actors of their linked adults
 * (ADR 0150 §3, ADR 0158): one call to the registered SECURITY DEFINER
 * function `daisy_round_linked_adult_actors`, over `daisy_linked_adult_users`
 * for each debater (`linkedAdultsOfRound` in `@daisy/auth/linked-adults` is its
 * TypeScript statement). It reads the debaters' guardian links and schools
 * across tenants in one statement, so it needs no scope and one snapshot
 * holds. Any Round that is not a Youth Round (`youthRoundSql`) has no
 * debaters here. Its Recording, its live audience in the web and the realtime
 * server all read it, and none writes any of it.
 */
export const readYouthRecordingPeople = async (tx: Tx, roundId: string) => {
  const rows = await rowsOf<{
    debater_actor_id: string;
    debater_user_id: string;
    linked_adult_actor_ids: string[];
  }>(tx, sql`select * from public.daisy_round_linked_adult_actors(${roundId})`);
  return {
    debaters: rows.map((row) => ({
      actorId: row.debater_actor_id,
      userId: row.debater_user_id,
      linkedAdultActorIds: row.linked_adult_actor_ids,
    })),
  };
};
