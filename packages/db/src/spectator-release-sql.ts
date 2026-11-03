import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';

/** The columns of the Round a release predicate reads, under any alias. */
export type ReleaseRound = {
  readonly id: SQL | unknown;
  readonly status: SQL | unknown;
  readonly competitionType: SQL | unknown;
  readonly completedAt: SQL | unknown;
};

/** The Round under the alias `r`, for raw reads. */
export const roundAliasR: ReleaseRound = {
  id: sql`r.id`,
  status: sql`r.status`,
  competitionType: sql`r.competition_type`,
  completedAt: sql`r.completed_at`,
};

const margin = sql.raw(`interval '${SPECTATOR_MARGIN_MS} milliseconds'`);

/**
 * The instant a read happens and the ranked delay in force. This adapter may
 * not import the domain, so the feature supplies the delay from
 * `RANKED_DELAY_SECONDS` in `@daisy/debate-engine`.
 */
export type SpectatorClock = {
  readonly now: string;
  readonly rankedDelaySeconds: number;
};

/**
 * `spectatorHorizon` from `@daisy/debate-engine` as a scalar, for list reads
 * that must filter in the database: a page, a count or a cursor. The two are
 * held equal by the spectator-release integration suite.
 */
export const spectatorHorizonSql = (
  round: ReleaseRound,
  clock: SpectatorClock,
) => {
  const at = sql`${clock.now}::timestamptz`;
  const rankedDelay = sql`make_interval(secs => ${clock.rankedDelaySeconds}::double precision)`;
  const terminal = sql`${round.status} in ('completed','abandoned')`;
  return sql`(select case
    when b.id is null then case when ${terminal} then
      case when ${round.competitionType}='ranked' then ${at}-${rankedDelay}+${margin} else ${at}+${margin} end end
    when b.completed_at is null and b.stopped_at is null then b.released_through_at
    else greatest(b.released_through_at, ${at}-make_interval(secs => (b.release_policy->>'seconds')::double precision))
  end from (select 1) one left join broadcasts b on b.round_id=${round.id})`;
};

/** Whether a fact captured at `capturedAt` has left: `factReleased` in SQL. */
export const factReleasedSql = (
  capturedAt: SQL | unknown,
  round: ReleaseRound,
  clock: SpectatorClock,
) =>
  sql`coalesce(${capturedAt}+${margin}<=${spectatorHorizonSql(round, clock)},false)`;

/**
 * A completed Round's outcome is public: a Round that has not completed has
 * no outcome to hold, and anything else waits for the timeline to pass it.
 */
export const outcomeReleasedSql = (
  round: ReleaseRound,
  clock: SpectatorClock,
) =>
  sql`(${round.status}<>'completed' or ${factReleasedSql(round.completedAt, round, clock)})`;

/**
 * A caption is known public: its segment has closed, or the control plane has been
 * heard from since it was said. It belongs to a committed segment by its foreign key,
 * so this is the one case left: a line on a segment still open past the last
 * heartbeat waits, like the media beside it.
 */
export const captionKnownPublicSql = (utterance: {
  readonly segmentId: SQL | unknown;
  readonly createdAt: SQL | unknown;
}) => sql`exists (
  select 1 from round_segments known_s
  left join broadcasts known_b on known_b.round_id = known_s.round_id
  where known_s.id = ${utterance.segmentId}
    and (known_s.ended_at is not null
      or known_b.id is null
      or known_b.control_heartbeat_at >= ${utterance.createdAt}))`;
