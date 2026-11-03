import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { factReleasedSql, type SpectatorClock } from './spectator-release-sql';

type Tx = Pick<BoundedTransactionContext, 'execute'>;

const round = {
  id: sql`r.id`,
  status: sql`r.status`,
  competitionType: sql`r.competition_type`,
  completedAt: sql`r.completed_at`,
};

/**
 * Appends every fact of a Round the timeline has now passed and no row records
 * yet. Run in the release step's transaction and by the sweep, so a fact's
 * release time is no later than one sweep after it left. The key is the fact
 * itself, so a repeat is a no-op and the first release time stands.
 */
export async function recordFactReleases(
  tx: Tx,
  input: { readonly roundId: string; readonly clock: SpectatorClock },
): Promise<number> {
  const released = (capturedAt: unknown) =>
    factReleasedSql(capturedAt, round, input.clock);
  const completed = sql`r.completed_at`;
  const rows = await tx.execute(sql`
    with facts(kind, fact_id, captured_at) as (
      select 'stage', s.id, s.started_at from round_segments s
        join rounds r on r.id=s.round_id
        where r.id=${input.roundId} and ${released(sql`s.started_at`)}
      union all
      select 'result', r.id, r.completed_at from rounds r
        where r.id=${input.roundId} and r.status='completed' and ${released(completed)}
      union all
      select 'ballot', b.id, r.completed_at from ballots b
        join rounds r on r.id=b.round_id
        where r.id=${input.roundId} and b.status='submitted' and r.competition_type='ranked'
          and r.status='completed' and ${released(completed)}
      union all
      select 'rating', c.id, greatest(c.occurred_at,r.completed_at) from rating_changes c
        join rounds r on r.id=c.round_id
        where r.id=${input.roundId} and ${released(sql`greatest(c.occurred_at,r.completed_at)`)}
      union all
      select 'caption', u.id, u.created_at from utterances u
        join rounds r on r.id=u.round_id
        where r.id=${input.roundId} and r.competition_type='ranked' and u.complete
          and ${released(sql`u.created_at`)}
    )
    insert into spectator_fact_releases (round_id, kind, fact_id, captured_at, released_at, watermark_at)
    select ${input.roundId}, f.kind, f.fact_id, f.captured_at, ${input.clock.now}::timestamptz,
      (select b.released_through_at from broadcasts b where b.round_id=${input.roundId})
    from facts f
    on conflict (round_id, kind, fact_id) do nothing
    returning fact_id`);
  return (rows as unknown as unknown[]).length;
}

/**
 * The Rounds with an audience that may have a fact still to record: live, or
 * ended inside the window. The sweep's input, for a Round no release step runs
 * on: a finished Broadcast, or none.
 */
export async function readRoundsAwaitingFactLog(
  tx: Tx,
  input: {
    readonly clock: SpectatorClock;
    readonly endedWithinHours: number;
    readonly limit: number;
  },
): Promise<readonly string[]> {
  const rows = await tx.execute(sql`select r.id from rounds r
    where r.room_id is not null and r.visibility in ('public','unlisted')
      and (r.status='active' or r.completed_at >= ${input.clock.now}::timestamptz - make_interval(hours => ${input.endedWithinHours}))
    order by r.id limit ${input.limit}`);
  return (rows as unknown as { id: string }[]).map((row) => row.id);
}
