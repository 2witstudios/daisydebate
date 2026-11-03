import { sql, type SQL } from 'drizzle-orm';

/**
 * Whether an actor is in a Round's live room: any seat, judges included, or the
 * host who watches it undelayed (`round.observe.undelayed`). They see ahead of
 * the audience's feed, so they take no part in its chat. A null actor is nobody.
 */
export const inLiveRoomSql = (
  round: { readonly id: SQL; readonly createdByActorId: SQL },
  actorId: string | null,
) =>
  sql`(coalesce(${round.createdByActorId}=${actorId}::text,false)
    or exists(select 1 from round_participants lr where lr.round_id=${round.id} and lr.actor_id=${actorId}::text))`;

/** The Round under the alias `r`, for raw reads. */
export const liveRoomOfR = {
  id: sql`r.id`,
  createdByActorId: sql`r.created_by_actor_id`,
};
