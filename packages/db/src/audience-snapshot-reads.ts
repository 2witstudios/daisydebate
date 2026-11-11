import {
  isRoundOver,
  type RoundStatus,
  SPECTATOR_CHAT_WINDOW,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readReactionTotals } from './audience-reactions';
import { rowsOf } from './raw-rows';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { readChatPage } from './messaging/spectator-chat';

/**
 * A Round's audience activity, in one snapshot, as it stands now: rows only, for
 * the feature to project and admit. Null when the Round has no audience. It knows
 * nothing of who is asking, so it can be held for everyone until it is admitted.
 */
export const audienceSnapshotReads = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  readAudienceSnapshot(input: {
    readonly roundId: string;
    readonly beforeSequence?: number;
  }) {
    return instrumented(eventSink, 'readAudienceSnapshot', () =>
      database.transaction(
        async (tx) => {
          const [round] = await rowsOf<{
            visibility: 'public' | 'unlisted';
            has_broadcast: boolean;
            open: boolean;
          }>(
            tx,
            sql`select r.visibility,
                b.id is not null as has_broadcast,
                (b.completed_at is null and b.stopped_at is null) as open
              from rounds r left join broadcasts b on b.round_id=r.id
              where r.id=${input.roundId} and r.visibility in ('public','unlisted') and r.room_id is not null`,
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
      const [row] = await rowsOf<{
        role: string | null;
        competition_type: 'ranked' | 'casual';
        status: RoundStatus;
        debaters_read_chat: boolean | null;
      }>(
        database,
        sql`select p.role,r.competition_type,r.status,b.debaters_read_chat
          from rounds r
          left join round_participants p on p.round_id=r.id and p.actor_id=${input.actorId}
          left join broadcasts b on b.round_id=r.id
          where r.id=${input.roundId}
            and (p.id is not null or r.created_by_actor_id=${input.actorId})
          limit 1`,
      );
      if (!row) return null;
      return row.role === null
        ? ({ kind: 'seatless-host' } as const)
        : ({
            kind: 'seat',
            role: row.role,
            competitionType: row.competition_type,
            roundEnded: isRoundOver(row.status),
            debatersReadChat: row.debaters_read_chat === true,
          } as const);
    });
  },
  /** Whose audience may count for this Round: null unless its Broadcast is open. */
  readOnAirAudience(input: { readonly roundId: string }) {
    return instrumented(eventSink, 'readOnAirAudience', async () => {
      const [row] = await rowsOf<{ visibility: 'public' | 'unlisted' }>(
        database,
        sql`select r.visibility from broadcasts b join rounds r on r.id=b.round_id
          where b.round_id=${input.roundId} and b.completed_at is null and b.stopped_at is null
            and r.visibility in ('public','unlisted') and r.room_id is not null`,
      );
      return row ? { visibility: row.visibility } : null;
    });
  },
});
