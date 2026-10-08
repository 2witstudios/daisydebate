import { createId } from '@paralleldrive/cuid2';
import type { Fixture } from './constraint-helpers';
import { validRules } from './round-fixtures';

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

/** A completed ranked round between two actors, outcome as given. */
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
  // A ranked round is constructed from a sanctioned preset, so it pins one.
  await fixture.preset(input.formatId, 'full');
  await fixture.insert('rounds', {
    id,
    room_id: null,
    created_by_actor_id: null,
    resolution: 'A resolution',
    competition_type: 'ranked',
    length: 'full',
    format_id: input.formatId,
    format_version: 1,
    preset_version: 1,
    rules_snapshot: validRules,
    status: 'completed',
    current_stage: null,
    outcome: input.outcome,
    ladder_id: 'ranked',
    started_at: at(5, 11),
    completed_at: at(5),
  });
  await fixture.participant(id, 'affirmative', 0, input.affirmative);
  await fixture.participant(id, 'negative', 0, input.negative);
  return id;
};

export const change = (
  fixture: Fixture,
  row: {
    roundId: string;
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
    round_id: row.roundId,
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

/**
 * A named format. There is no `ranked_eligible` flag to set: ratedness is
 * constructed from a sanctioned preset (ADR 0058 §4), so a fixture that needs a
 * ranked round calls `preset` against the format this returns.
 */
export const formatNamed = async (fixture: Fixture, name: string) => {
  const id = await fixture.format();
  await fixture.sql.unsafe('update formats set name = $2 where id = $1', [
    id,
    name,
  ]);
  return id;
};
