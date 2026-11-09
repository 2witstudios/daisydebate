import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import {
  captionHeardAtSql,
  captionKnownPublicSql,
  factReleasedSql,
  roundAliasR as round,
  type SpectatorClock,
} from './spectator-release-sql';

type Tx = Pick<BoundedTransactionContext, 'execute'>;

const heardAt = captionHeardAtSql({
  createdAt: sql`u.created_at`,
  botDurationMs: sql`u.bot_duration_ms`,
});
const margin = sql.raw(`interval '${SPECTATOR_MARGIN_MS} milliseconds'`);

/**
 * Every fact of the Round under the alias `r` the log keeps, each with its
 * capture time: one list for what a pass records and what it looks for.
 */
const factsOfRound = sql`(
  select 'stage' as kind, s.id as fact_id, s.started_at as captured_at from round_segments s
    where s.round_id=r.id and s.started_at is not null
  union all
  select 'resolution', r.id, r.started_at where r.resolution is not null and r.started_at is not null
  union all
  select 'result', r.id, r.completed_at where r.status='completed'
  union all
  select 'ballot', b.id, r.completed_at from ballots b
    where b.round_id=r.id and r.competition_type='ranked' and r.status='completed'
  union all
  select 'rating', c.id, greatest(c.occurred_at,r.completed_at) from rating_changes c
    where c.round_id=r.id
  union all
  select 'caption', u.id, ${heardAt} from utterances u
    where u.round_id=r.id and r.competition_type='ranked' and u.complete
      and ${captionKnownPublicSql({ segmentId: sql`u.segment_id`, createdAt: heardAt })}
) f`;

/**
 * Appends every fact of a Round the timeline has now passed and no row records
 * yet. The sweep is its one writer, so a release time is at most one pass after
 * the fact left, never before it. The key is the fact itself, so a repeat is a
 * no-op and the first release time stands.
 */
export async function recordFactReleases(
  tx: Tx,
  input: { readonly roundId: string; readonly clock: SpectatorClock },
): Promise<number> {
  const rows = await tx.execute(sql`
    insert into spectator_fact_releases (round_id, kind, fact_id, captured_at, released_at, watermark_at, basis)
    select r.id, f.kind, f.fact_id, f.captured_at, ${input.clock.now}::timestamptz,
      b.released_through_at,
      case
        when b.released_through_at >= f.captured_at + ${margin} then 'watermark'
        when b.id is not null then 'broadcast_ended'
        when r.competition_type = 'ranked' then 'clock_fallback'
        else 'no_broadcast'
      end
    from rounds r
    cross join lateral ${factsOfRound}
    left join broadcasts b on b.round_id = r.id
    where r.id = ${input.roundId}
      and ${factReleasedSql(sql`f.captured_at`, round, input.clock)}
    on conflict (round_id, kind, fact_id) do nothing
    returning fact_id`);
  return (rows as unknown as unknown[]).length;
}

const unlogged = sql`not exists (
  select 1 from spectator_fact_releases l
  where l.round_id=r.id and l.kind=f.kind and l.fact_id=f.fact_id)`;
const hasAudience = sql`r.room_id is not null and r.visibility in ('public','unlisted')`;

/**
 * The open Rounds with an audience holding a fact that has left and no row
 * records: exactly what a pass has to do. It starts from the open rows, so
 * finished Rounds cost nothing however many there are. A recorded Round drops
 * out, so a full batch starves nothing, and a hold of any length needs no window.
 */
export async function readRoundsAwaitingFactLog(
  tx: Tx,
  input: { readonly clock: SpectatorClock; readonly limit: number },
): Promise<readonly string[]> {
  const rows = await tx.execute(sql`select r.id
    from spectator_fact_log_open_rounds o
    join rounds r on r.id=o.round_id
    where ${hasAudience}
      and exists (
        select 1 from lateral ${factsOfRound}
        where ${unlogged}
          and ${factReleasedSql(sql`f.captured_at`, round, input.clock)}
      )
    order by r.id limit ${input.limit}`);
  return (rows as unknown as { id: string }[]).map((row) => row.id);
}

/**
 * Removes the open rows with nothing left to do: a Round with no audience, or one
 * that is over with every fact logged. The removal holds only if `touched_at` has
 * not moved, because a fact's trigger locks and touches the row: this waits for it
 * and then leaves the row, however the two interleave.
 */
export async function closeSettledFactLogRounds(tx: Tx): Promise<number> {
  const rows = await tx.execute(sql`with settled as (
      select o.round_id, o.touched_at
      from spectator_fact_log_open_rounds o
      join rounds r on r.id=o.round_id
      where not (${hasAudience})
        or (r.status in ('completed','abandoned')
          and not exists (select 1 from lateral ${factsOfRound} where ${unlogged}))
    )
    delete from spectator_fact_log_open_rounds o using settled s
    where o.round_id=s.round_id and o.touched_at=s.touched_at
    returning o.round_id`);
  return (rows as unknown as unknown[]).length;
}

/** Records the log for every Round that may have a fact to record; a sweep's pass. */
export const spectatorFactLogOperations = ({
  database,
}: {
  readonly database: Tx;
}) => ({
  async sweepSpectatorFactLog(input: {
    readonly clock: SpectatorClock;
    readonly limit: number;
  }): Promise<number> {
    const roundIds = await readRoundsAwaitingFactLog(database, input);
    const recorded = await Promise.all(
      roundIds.map((roundId) =>
        recordFactReleases(database, { roundId, clock: input.clock }),
      ),
    );
    await closeSettledFactLogRounds(database);
    return recorded.reduce((sum, count) => sum + count, 0);
  },
});
