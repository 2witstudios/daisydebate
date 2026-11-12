import { sql } from 'drizzle-orm';
import type { RoomCommunityFact } from '@daisy/protocol/room-community';
import type { AuthorizationTransaction } from '../authorization';
import { rowsOf } from '../raw-rows';

type RoomCommunityRow = {
  readonly actor_id: string;
  readonly version: number;
  readonly status: RoomCommunityFact['status'];
  readonly visibility: RoomCommunityFact['visibility'];
  readonly ended_at: Date | null;
  readonly standing: RoomCommunityFact['standing'];
  readonly channel_id: string | null;
  readonly authority_revision: number | null;
};
const factOf = (roomId: string, row: RoomCommunityRow): RoomCommunityFact => ({
  kind: 'room_community',
  roomId,
  channelId: row.channel_id,
  policyKey: 'room.community',
  policyRevision: 1,
  revision: Number(row.version) + Number(row.authority_revision ?? 0),
  status: row.status,
  visibility: row.visibility,
  endedAt: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
  actorId: row.actor_id,
  standing: row.standing,
});

/** Only the requested callers' standings cross the boundary, in one cohort statement. */
export async function readRoomCommunityFacts(
  tx: AuthorizationTransaction,
  roomId: string,
  actorIds: readonly string[],
): Promise<ReadonlyMap<string, RoomCommunityFact>> {
  if (actorIds.length === 0) return new Map();
  const rows = await rowsOf<RoomCommunityRow>(
    tx,
    sql`select wanted.actor_id,f.* from unnest(array[${sql.join(
      actorIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]) as wanted(actor_id) cross join lateral public.daisy_room_community_fact(${roomId}::text,wanted.actor_id) f`,
  );
  return new Map(rows.map((row) => [row.actor_id, factOf(roomId, row)]));
}
export async function readRoomCommunityFact(
  tx: AuthorizationTransaction,
  roomId: string,
  actorId: string,
): Promise<RoomCommunityFact | null> {
  return (
    (await readRoomCommunityFacts(tx, roomId, [actorId])).get(actorId) ?? null
  );
}

/**
 * Account -> Room -> channel -> stream is Room chat's global lock order. Room
 * commands hold the Room row exclusively, so Start and close wait for a chat
 * write in flight and every later one sees the Room they left.
 */
export async function fenceRoomCommunity(
  tx: AuthorizationTransaction,
  roomId: string,
) {
  const [row] = await tx.execute(
    sql`select public.daisy_room_community_read_fence(${roomId}::text) as locked`,
  );
  return row?.locked === true;
}
