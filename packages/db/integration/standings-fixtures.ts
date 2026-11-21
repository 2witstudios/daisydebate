import { emptyRuntimeCheckpointFor } from '@daisy/protocol';
import { frozenJudgingFor } from '../src/round-judging-freeze';
import { createId } from '@paralleldrive/cuid2';
import type { Fixture } from './constraint-helpers';
import { validRules } from './round-fixtures';
import { publicLobbyId } from '../src/daisy-reference';

/** Fixtures for the standings reads suite (RATE-1.4.1). */

/**
 * The Open division for a row of `table` once ADR 0147's ladder-division
 * migration has run, and nothing before it: migration proofs seed through
 * these fixtures on earlier schemas too.
 */
const openDivision = async (
  fixture: Fixture,
  table: string,
  column = 'division',
): Promise<Record<string, string>> => {
  const [found] = (await fixture.sql`select 1 from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and column_name = ${column}`) as unknown[];
  return found ? { [column]: 'open' } : {};
};

export const at = (day: number, hour = 12) =>
  new Date(Date.UTC(2026, 9, day, hour));

export const season = async (
  fixture: Fixture,
  status: 'active' | 'closed',
  startsAt: Date,
) => {
  const id = createId();
  await fixture.insert('seasons', {
    ...(await openDivision(fixture, 'seasons')),
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
    seasonId?: string;
  },
) => {
  // A ranked round is constructed from a sanctioned preset, so it pins one.

  const { id } = await fixture.roundWithCast(
    {
      room_id: null,
      created_by_actor_id: null,
      resolution: 'A resolution',
      competition_type: 'ranked',
      format_id: input.formatId,
      format_version: 1,
      preset_version: 1,
      rules_snapshot: validRules,
      status: 'completed',
      current_stage: null,
      winning_side: input.outcome,
      runtime_state: emptyRuntimeCheckpointFor(validRules),
      judging: frozenJudgingFor(validRules),
      ladder_id: input.formatId,
      ...(input.seasonId
        ? {
            rating_lobby_id: publicLobbyId,
            season_id: input.seasonId,
            visibility: 'public',
          }
        : {}),
      ...(await openDivision(fixture, 'rounds', 'ladder_division')),
      started_at: at(5, 11),
      completed_at: at(5),
    },
    [
      { seat: 'affirmative', actorId: input.affirmative },
      { seat: 'negative', actorId: input.negative },
    ],
  );
  return id;
};

export const change = async (
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
    ...(await openDivision(fixture, 'rating_changes')),
    rating_before: row.before,
    rating_after: row.after,
    deviation_before: 350,
    deviation_after: 300,
    volatility_before: 0.06,
    volatility_after: 0.06,
    calculation_version: 'glicko2-v1',
    occurred_at: row.occurredAt,
  });

export const rating = async (
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
      season_id: row.seasonId,
      ladder: row.ladder,
      ...(await openDivision(fixture, 'ratings')),
      rating: row.rating,
      deviation: 300,
      volatility: 0.06,
    },
    'actor_id',
  );
