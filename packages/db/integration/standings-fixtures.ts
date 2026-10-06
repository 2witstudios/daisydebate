import { createId } from '@paralleldrive/cuid2';
import { snapshotFor, type Fixture } from './constraint-helpers';

/** Fixtures for the standings reads suite (RATE-1.4.1). */

export const at = (day: number, hour = 12) =>
  new Date(Date.UTC(2026, 9, day, hour));

export const season = async (
  fixture: Fixture,
  status: 'scheduled' | 'active' | 'closed',
  startsAt: Date,
) => {
  const id = createId();
  await fixture.insert('seasons', {
    id,
    name: `Season ${status}`,
    starts_at: startsAt,
    ends_at:
      status === 'closed' ? new Date(startsAt.getTime() + 86_400_000) : null,
    status,
  });
  return id;
};

/** A completed debate between two actors, outcome as given. */
export const completed = async (
  fixture: Fixture,
  input: {
    formatId: string;
    affirmative: string;
    negative: string;
    outcome: string;
  },
) => {
  const id = createId();
  await fixture.insert('debates', {
    id,
    created_by_actor_id: null,
    resolution: 'r',
    format_id: input.formatId,
    snapshot: snapshotFor(id, { phase: 'completed' }),
    mode: 'ranked',
    phase: 'completed',
    visibility: 'public',
    started_at: at(5, 11),
    completed_at: at(5),
    outcome: input.outcome,
  });
  await fixture.participant(id, 'affirmative', 0, input.affirmative);
  await fixture.participant(id, 'negative', 0, input.negative);
  return id;
};

export const change = (
  fixture: Fixture,
  row: {
    debateId: string;
    actorId: string;
    formatId: string;
    seasonId: string;
    ladder: string;
    before: number;
    after: number;
    occurredAt: Date;
  },
) =>
  fixture.insert('rating_changes', {
    id: createId(),
    debate_id: row.debateId,
    actor_id: row.actorId,
    format_id: row.formatId,
    season_id: row.seasonId,
    ladder: row.ladder,
    rating_before: row.before,
    rating_after: row.after,
    deviation_before: 350,
    deviation_after: 300,
    volatility_before: 0.06,
    volatility_after: 0.06,
    calculation_version: 'glicko2-v1',
    occurred_at: row.occurredAt,
  });

export const rating = (
  fixture: Fixture,
  row: {
    actorId: string;
    formatId: string;
    seasonId: string;
    ladder: string;
    rating: number;
  },
) =>
  fixture.insert(
    'ratings',
    {
      actor_id: row.actorId,
      format_id: row.formatId,
      season_id: row.seasonId,
      ladder: row.ladder,
      rating: row.rating,
      deviation: 300,
      volatility: 0.06,
    },
    'actor_id',
  );

export const formatNamed = async (fixture: Fixture, name: string) => {
  const id = await fixture.format();
  await fixture.sql.unsafe(
    'update formats set ranked_eligible = true, name = $2 where id = $1',
    [id, name],
  );
  return id;
};
