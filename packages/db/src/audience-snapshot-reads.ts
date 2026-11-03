import { SPECTATOR_CHAT_WINDOW } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { readReleasedReactions } from './audience-reactions';
import { rowsOf } from './raw-rows';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { readReleasedChat } from './messaging/spectator-chat';
import {
  roundAliasR,
  spectatorHorizonSql,
  type SpectatorClock,
} from './spectator-release-sql';

/**
 * A Round's audience activity, in one snapshot and all of it released: rows
 * only, for the feature to project. Null when the Round has no audience. It knows
 * nothing of who is asking, so it can be cached for everyone. `horizonMs` is how
 * far the timeline has reached, for the feature's count.
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
    readonly clock: SpectatorClock;
    readonly beforeSequence?: number;
  }) {
    return instrumented(eventSink, 'readAudienceSnapshot', () =>
      database.transaction(
        async (tx) => {
          const [round] = await rowsOf<{
            horizon: string | Date | null;
            has_broadcast: boolean;
            open: boolean;
          }>(
            tx,
            sql`select ${spectatorHorizonSql(roundAliasR, input.clock)} as horizon,
                b.id is not null as has_broadcast,
                (b.completed_at is null and b.stopped_at is null) as open
              from rounds r left join broadcasts b on b.round_id=r.id
              where r.id=${input.roundId} and r.visibility in ('public','unlisted') and r.room_id is not null`,
          );
          if (!round) return null;
          return {
            hasBroadcast: round.has_broadcast,
            open: round.has_broadcast && round.open,
            horizonMs: round.horizon ? new Date(round.horizon).getTime() : null,
            messages: await readReleasedChat(tx, {
              roundId: input.roundId,
              clock: input.clock,
              limit: SPECTATOR_CHAT_WINDOW,
              ...(input.beforeSequence === undefined
                ? {}
                : { beforeSequence: input.beforeSequence }),
            }),
            reactions: await readReleasedReactions(tx, {
              roundId: input.roundId,
              clock: input.clock,
            }),
          };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  },
  /**
   * What a seated reader's view turns on, for the feature's rule. A viewer with
   * no seat gets the public snapshot and never needs this.
   */
  readAudienceSeat(input: {
    readonly roundId: string;
    readonly actorId: string;
  }) {
    return instrumented(eventSink, 'readAudienceSeat', async () => {
      const [row] = await rowsOf<{
        role: string;
        competition_type: 'ranked' | 'casual';
        status: string;
        debaters_read_chat: boolean | null;
      }>(
        database,
        sql`select p.role,r.competition_type,r.status,b.debaters_read_chat
          from round_participants p join rounds r on r.id=p.round_id
          left join broadcasts b on b.round_id=r.id
          where p.round_id=${input.roundId} and p.actor_id=${input.actorId} limit 1`,
      );
      return row
        ? {
            role: row.role,
            competitionType: row.competition_type,
            roundEnded:
              row.status === 'completed' || row.status === 'abandoned',
            debatersReadChat: row.debaters_read_chat === true,
          }
        : null;
    });
  },
  /** Whether counts may gather for this Round: it has an open Broadcast. */
  readBroadcastOnAir(input: { readonly roundId: string }) {
    return instrumented(eventSink, 'readBroadcastOnAir', async () => {
      const [row] = await rowsOf(
        database,
        sql`select 1 from broadcasts b join rounds r on r.id=b.round_id
          where b.round_id=${input.roundId} and b.completed_at is null and b.stopped_at is null
            and r.visibility in ('public','unlisted') and r.room_id is not null`,
      );
      return row !== undefined;
    });
  },
});
