import { sql } from 'drizzle-orm';
import type { RoomCommunityFact } from '@daisy/protocol/room-community';
import { postgresInt8, query } from '../raw-rows';
import type { Tx } from '../tx';
import { seatKindSchema, roomStatuses } from '@daisy/protocol';
import { z } from 'zod';

type RoomCommunityRow = {
  readonly actor_id: string;
  readonly version: z.output<typeof postgresInt8>;
  readonly status: RoomCommunityFact['status'];
  readonly visibility: RoomCommunityFact['visibility'];
  readonly ended_at: Date | null;
  readonly host: boolean | null;
  readonly seat_kind: RoomCommunityFact['seatKind'];
  readonly channel_id: string | null;
  readonly authority_revision: z.output<typeof postgresInt8> | null;
  readonly youth_room: boolean;
  readonly youth_staff: boolean;
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
  host: row.host === true,
  seatKind: row.seat_kind,
  youthRoom: row.youth_room === true,
  youthStaff: row.youth_staff === true,
});

/** Only the requested callers' own facts cross the boundary, in one cohort statement. */
export async function readRoomCommunityFacts(
  tx: Tx,
  roomId: string,
  actorIds: readonly string[],
): Promise<ReadonlyMap<string, RoomCommunityFact>> {
  if (actorIds.length === 0) return new Map();
  const rows = await query(
    tx,
    z.object({
      actor_id: z.string(),
      version: postgresInt8,
      status: z.enum(roomStatuses),
      visibility: z.enum(['public', 'unlisted', 'private']),
      ended_at: z.date().nullable(),
      host: z.boolean().nullable(),
      seat_kind: seatKindSchema.nullable(),
      channel_id: z.string().nullable(),
      authority_revision: postgresInt8.nullable(),
      youth_room: z.boolean(),
      youth_staff: z.boolean(),
    }),
    sql`select wanted.actor_id,f.* from unnest(array[${sql.join(
      actorIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]) as wanted(actor_id) cross join lateral public.daisy_room_community_fact(${roomId}::text,wanted.actor_id) f`,
  );
  return new Map(rows.map((row) => [row.actor_id, factOf(roomId, row)]));
}
export async function readRoomCommunityFact(
  tx: Tx,
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
export async function fenceRoomCommunity(tx: Tx, roomId: string) {
  const [row] = await query(
    tx,
    z.object({ locked: z.boolean() }),
    sql`select public.daisy_room_community_read_fence(${roomId}::text) as locked`,
  );
  return row?.locked === true;
}
