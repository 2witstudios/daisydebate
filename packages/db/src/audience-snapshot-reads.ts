import { roomVisibilities } from '@daisy/protocol/room-contract';
import { listedWord } from './lifecycle-sql';
import {
  isRoundOver,
  roundStatusSchema,
  competitionTypes,
} from '@daisy/protocol/round';
import { SPECTATOR_CHAT_WINDOW } from '@daisy/protocol/audience';
import { seatKindSchema } from '@daisy/protocol/seats';
import { sql } from 'drizzle-orm';
import { readReactionTotals } from './audience-reactions';
import { query } from './raw-rows';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { readChatPage } from './messaging/spectator-chat';
import { inTransaction, type TxSource } from './tx';
import { z } from 'zod';

/**
 * A Round's audience activity, in one snapshot, as it stands now: rows only, for
 * the feature to project and admit. Null when the Round has no audience. It knows
 * nothing of who is asking, so it can be held for everyone until it is admitted.
 */
export const audienceSnapshotReads = ({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readAudienceSnapshot(input: {
    readonly roundId: string;
    readonly beforeSequence?: number;
  }) {
    return instrumented(eventSink, 'readAudienceSnapshot', () =>
      inTransaction(
        database,
        async (tx) => {
          const [round] = await query(
            tx,
            z.object({
              visibility: z.enum(['public', 'unlisted']),
              has_broadcast: z.boolean(),
              open: z.boolean(),
            }),
            sql`select r.visibility,
                b.id is not null as has_broadcast,
                (b.completed_at is null and b.stopped_at is null) as open
              from rounds r left join broadcasts b on b.round_id=r.id
              where r.id=${input.roundId} and r.visibility in (${listedWord(roomVisibilities, 'public')},${listedWord(roomVisibilities, 'unlisted')}) and r.room_id is not null`,
          );
          if (!round) return null;
          return {
            visibility: round.visibility,
            hasBroadcast: round.has_broadcast,
            open: round.has_broadcast && round.open,
            messages: await readChatPage(tx, {
              roundId: input.roundId,
              limit: SPECTATOR_CHAT_WINDOW,
              ...(input.beforeSequence === undefined
                ? {}
                : { beforeSequence: input.beforeSequence }),
            }),
            reactions: await readReactionTotals(tx, {
              roundId: input.roundId,
            }),
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  },
  /**
   * How this actor stands in the Round's live room, for the feature's rule: a seat
   * of any role, a host with no seat, or null for everyone else.
   */
  readLiveRoomStanding(input: {
    readonly roundId: string;
    readonly actorId: string;
  }) {
    return instrumented(eventSink, 'readLiveRoomStanding', async () => {
      const [row] = await query(
        database,
        z.object({
          seat_kind: seatKindSchema.nullable(),
          competition_type: z.enum(competitionTypes),
          status: roundStatusSchema,
          debaters_read_chat: z.boolean().nullable(),
        }),
        sql`select p.seat_kind,r.competition_type,r.status,b.debaters_read_chat
          from rounds r
          left join round_participants p on p.round_id=r.id and p.actor_id=${input.actorId} and public.daisy_round_participant_is_current(p.id)
          left join broadcasts b on b.round_id=r.id
          where r.id=${input.roundId}
            and (p.id is not null or r.created_by_actor_id=${input.actorId})
          limit 1`,
      );
      if (!row) return null;
      return row.seat_kind === null
        ? ({ kind: 'seatless-host' } as const)
        : ({
            kind: 'seat',
            seatKind: row.seat_kind,
            competitionType: row.competition_type,
            roundEnded: isRoundOver(row.status),
            debatersReadChat: row.debaters_read_chat === true,
          } as const);
    });
  },
  /** Whose audience may count for this Round: null unless its Broadcast is open. */
  readOnAirAudience(input: { readonly roundId: string }) {
    return instrumented(eventSink, 'readOnAirAudience', async () => {
      const [row] = await query(
        database,
        z.object({ visibility: z.enum(['public', 'unlisted']) }),
        sql`select r.visibility from broadcasts b join rounds r on r.id=b.round_id
          where b.round_id=${input.roundId} and b.completed_at is null and b.stopped_at is null
            and r.visibility in (${listedWord(roomVisibilities, 'public')},${listedWord(roomVisibilities, 'unlisted')}) and r.room_id is not null`,
      );
      return row ? { visibility: row.visibility } : null;
    });
  },
});
