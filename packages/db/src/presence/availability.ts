import { sql, type SQL } from 'drizzle-orm';
import type { MemberPlacement } from '@daisy/protocol';
import { roomIsOpen } from '../room-open';
import type { Tx } from '../tx';
import { query as queryRows } from '../raw-rows';
import { z } from 'zod';

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
  sql<MemberPlacement>`(select ${placementSql} from active_seats m join rooms on rooms.id = m.room_id where m.actor_id = ${actorId})`;

/** Whether a member can take a challenge now: their choice and placement. */
export async function readAvailability(tx: Tx, actorId: string) {
  const [row] = await queryRows(
    tx,
    z.object({
      chosen: z.enum(['online', 'busy', 'appearing_offline']),
      placement: z.enum(['round', 'room']).nullable(),
    }),
    sql`
    select coalesce((select chosen_status from presence_settings where actor_id = ${actorId}), 'online') as chosen,
      ${placementOf(sql`${actorId}`)} as placement`,
  );
  return row ?? { chosen: 'online' as const, placement: null };
}
