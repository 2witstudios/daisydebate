import { recordingLifecycleSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { RecordingModeration } from './content-moderation-ports';
import { inLiveRoomSql, liveRoomOfR } from './live-room-sql';

type ReportRow = {
  readonly competition_type: string;
  readonly round_id: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly audience_link_hash: string | null;
  readonly reporter_seated: boolean;
  readonly in_live_room: boolean;
};

/**
 * Moderation's reach into Recording (WATCH-7). A takedown runs in the command's
 * transaction under the row lock and keeps a ready Recording's media to restore,
 * the same move as `taken_down` in the Recording's lifecycle. Every read of it
 * then answers as removed. A removal already under way stands.
 */
export const recordingModeration: RecordingModeration = {
  readReportFacts: async (tx, input) => {
    const rows = await tx.execute(sql`
      select r.competition_type, r.id as round_id, r.visibility, r.audience_link_hash,
        exists(select 1 from round_participants p
          where p.round_id=r.id and p.actor_id=${input.reporterActorId}) as reporter_seated,
        ${inLiveRoomSql(liveRoomOfR, input.reporterActorId)} as in_live_room
      from recordings rec join rounds r on r.id=rec.round_id
      where rec.id=${input.recordingId}`);
    const [row] = rows as unknown as ReportRow[];
    return row
      ? {
          ranked: row.competition_type === 'ranked',
          reporterSeated: row.reporter_seated,
          audience: {
            roundId: row.round_id,
            visibility: row.visibility,
            audienceLinkHash: row.audience_link_hash,
            inLiveRoom: row.in_live_room,
          },
        }
      : null;
  },
  exists: async (tx, recordingId) => {
    const rows = await tx.execute(
      sql`select 1 from recordings where id=${recordingId}`,
    );
    return (rows as unknown as unknown[]).length > 0;
  },
  takeDown: async (tx, input) => {
    const rows = await tx.execute(
      sql`select lifecycle from recordings where id=${input.recordingId} for update`,
    );
    const [row] = rows as unknown as { readonly lifecycle: unknown }[];
    if (!row) return null;
    const lifecycle = recordingLifecycleSchema.parse(row.lifecycle);
    if (
      lifecycle.status === 'taken_down' ||
      lifecycle.status === 'removing' ||
      lifecycle.status === 'removed'
    )
      return 'unchanged';
    const next = recordingLifecycleSchema.parse({
      status: 'taken_down',
      takenDownAt: input.now.toISOString(),
      held: lifecycle.status === 'ready' ? lifecycle : null,
    });
    await tx.execute(sql`update recordings set lifecycle=${JSON.stringify(next)}::text::jsonb,
        status='taken_down', version=version+1, updated_at=clock_timestamp()
      where id=${input.recordingId}`);
    return 'applied';
  },
};
