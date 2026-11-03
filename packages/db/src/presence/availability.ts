import { sql, type SQL } from 'drizzle-orm';
import type { ChosenStatus, MemberPlacement } from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';
import { roomIsOpen } from '../room-open';

/** Rooms' and Rounds' published fact, for the membership row `m` joined to `rooms`. */
const placementSql = sql<MemberPlacement>`case
  when rooms.id is null then null
  when ${roomIsOpen()} then 'room'
  else 'round' end`;

/**
 * Presence's published read for another query: where the member named by
 * `actorId` is. Null when they hold no active Room.
 */
export const placementOf = (actorId: SQL) =>
  sql<MemberPlacement>`(select ${placementSql} from room_active_memberships m join rooms on rooms.id = m.room_id where m.actor_id = ${actorId})`;

/** Whether a member can take a challenge now: their choice and placement. */
export async function readAvailability(
  tx: AuthorizationTransaction,
  actorId: string,
) {
  const [row] = (await tx.execute(sql`
    select coalesce((select chosen_status from presence_settings where actor_id = ${actorId}), 'online') as chosen,
      ${placementOf(sql`${actorId}`)} as placement`)) as unknown as {
    chosen: ChosenStatus;
    placement: MemberPlacement;
  }[];
  return row ?? { chosen: 'online' as const, placement: null };
}
