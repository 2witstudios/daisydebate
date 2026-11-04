import { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { audienceSnapshotReads } from './audience-snapshot-reads';
import { rowsOf } from './raw-rows';
import { spectatorTimelineReads } from './spectator-timeline-reads';

export { audienceStateKey } from './audience-state-key';

export type PublishingBroadcast = {
  readonly broadcastId: string;
  readonly roundId: string;
  readonly feedKey: string;
  readonly linkHash: string | null;
  /** Its window has closed: the state goes and no pass looks here again. */
  readonly over: boolean;
};

/**
 * The audience publisher's one credential: released public facts, read only, and
 * one column to say a Broadcast's state is gone. Apart from the hold worker's role,
 * which reads no Round (ADR 0099, DEC-350).
 */
export const createAudiencePublisherStore = (url: string) => {
  const client = new SQL(url, { max: 2 });
  const database = drizzle({ client });
  const timeline = spectatorTimelineReads({ database });
  const audience = audienceSnapshotReads({ database });
  return {
    /**
     * Every Broadcast with state to publish, oldest first. A Broadcast's window
     * closes once the Round's Recording has settled, or at `keepMs` past its end.
     */
    readPublishing: async (input: {
      readonly now: Date;
      readonly keepMs: number;
      readonly settledKeepMs: number;
      readonly limit: number;
    }): Promise<readonly PublishingBroadcast[]> => {
      const rows = await rowsOf<{
        id: string;
        round_id: string;
        feed_key: string;
        audience_link_hash: string | null;
        over: boolean;
      }>(
        database,
        sql`select b.id,b.round_id,b.feed_key,r.audience_link_hash,
            coalesce(
              coalesce(b.stopped_at,b.completed_at)
                + make_interval(secs => case
                    when rc.status is null or rc.status in ('ready','failed','taken_down','removing','removed')
                    then ${input.settledKeepMs / 1000}::double precision
                    else ${input.keepMs / 1000}::double precision end)
                <= ${input.now.toISOString()}::timestamptz,
              false) as over
          from broadcasts b
          join rounds r on r.id=b.round_id
          left join recordings rc on rc.round_id=b.round_id
          where b.audience_state_withdrawn_at is null
            and r.visibility in ('public','unlisted')
          order by b.created_at limit ${input.limit}`,
      );
      return rows.map((row) => ({
        broadcastId: row.id,
        roundId: row.round_id,
        feedKey: row.feed_key,
        linkHash: row.audience_link_hash,
        over: row.over,
      }));
    },
    readSpectatorTimeline: timeline.readSpectatorTimeline,
    readAudienceSnapshot: audience.readAudienceSnapshot,
    recordStateWithdrawn: async (input: {
      readonly broadcastId: string;
      readonly at: Date;
    }) => {
      await database.execute(
        sql`update broadcasts set audience_state_withdrawn_at=${input.at.toISOString()}::timestamptz where id=${input.broadcastId}`,
      );
    },
    close: () => client.close(),
  };
};
