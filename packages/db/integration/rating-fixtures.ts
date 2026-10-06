import { createId } from '@paralleldrive/cuid2';
import type {
  DebaterStanding,
  RatingPlanFacts,
  RatingState,
} from '@daisy/protocol';
import { createDatabase, type Database } from '../src';
import type { RatingDecision } from '../src/rating-facts';
import { snapshotFor, withFixture, type Fixture } from './constraint-helpers';

/** Fixtures for the rating adapter suite (RATE-1.3). */

const newcomer: RatingState = {
  rating: 1500,
  deviation: 350,
  volatility: 0.06,
};

const startOf = (standing: DebaterStanding | undefined): RatingState =>
  standing?.current?.state ?? standing?.previous ?? newcomer;

const deltaFor = (outcome: string, side: string) =>
  outcome === 'draw' ? 0 : outcome === side ? 10 : -10;

/**
 * A stand-in for the engine's decision (`@daisy/debate-engine`'s
 * `ratingDecision`), which this adapter must not import: it rates ranked and
 * quick debates and moves the winner up ten points from the loaded standing,
 * so a test can see exactly which facts the adapter loaded and what it wrote.
 */
export const stub = (seen: RatingPlanFacts[] = []): RatingDecision => ({
  eligibility: ({ mode, alreadyRated, outcome, completedAt }) => {
    if (mode !== 'ranked' && mode !== 'quick')
      return { kind: 'unrated', reason: 'mode' };
    if (alreadyRated) return { kind: 'already-rated' };
    return outcome === null || outcome === 'abandoned' || !completedAt
      ? { kind: 'unrated', reason: 'abandoned' }
      : { kind: 'rated', ladder: mode, outcome, occurredAt: completedAt };
  },
  plan: (facts) => {
    seen.push(facts);
    if (facts.seasonId === null) throw new Error('stub: no active season');
    const change = (side: 'affirmative' | 'negative', changeId: string) => {
      const seat = facts.seats.find(({ role }) => role === side);
      if (!seat) throw new Error('stub: missing seat');
      const standing = facts.standings[seat.actorId];
      const before = startOf(standing);
      const delta = deltaFor(facts.outcome, side);
      return {
        changeId,
        actorId: seat.actorId,
        before,
        after: {
          rating: before.rating + delta,
          deviation: before.deviation - 1,
          volatility: before.volatility,
        },
        expectedVersion: standing?.current?.version ?? null,
      };
    };
    return {
      ladder: facts.ladder,
      seasonId: facts.seasonId,
      occurredAt: facts.occurredAt,
      calculationVersion: 'stub-v1',
      changes: [
        change('affirmative', facts.changeIds[0]),
        change('negative', facts.changeIds[1]),
      ],
    };
  },
});

export const completedAt = (minute: number) =>
  new Date(Date.UTC(2026, 9, 5, 12, minute));

/** A completed debate between two actors on one format. */
const completedDebate = async (
  fixture: Fixture,
  input: {
    formatId: string;
    affirmative: string;
    negative: string;
    mode?: string;
    outcome?: string;
    minute?: number;
  },
) => {
  const id = createId();
  fixture.track('debates', id);
  await fixture.insert('debates', {
    id,
    created_by_actor_id: null,
    resolution: 'r',
    format_id: input.formatId,
    snapshot: snapshotFor(id, { phase: 'completed' }),
    mode: input.mode ?? 'ranked',
    phase: 'completed',
    visibility: 'public',
    started_at: completedAt(0),
    completed_at: completedAt(input.minute ?? 30),
    outcome: input.outcome ?? 'affirmative',
  });
  await fixture.participant(id, 'affirmative', 0, input.affirmative);
  await fixture.participant(id, 'negative', 0, input.negative);
  return id;
};

const activeSeason = async (fixture: Fixture, startsAt = completedAt(0)) => {
  const id = createId();
  await fixture.insert('seasons', {
    id,
    name: 'Season',
    starts_at: startsAt,
    status: 'active',
  });
  return id;
};

/** Tracks the ledger rows and projections a test writes, for the purge. */
const trackRatings = (fixture: Fixture, debateIds: readonly string[]) =>
  fixture.sql.unsafe(
    `delete from rating_changes where debate_id in (${debateIds.map((_, index) => `$${index + 1}`).join(', ')})`,
    [...debateIds],
  );

export const ratingsOf = async (fixture: Fixture, actorId: string) =>
  (await fixture.sql.unsafe(
    'select ladder, rating, deviation, version from ratings where actor_id = $1 order by ladder',
    [actorId],
  )) as Array<{
    ladder: string;
    rating: number;
    deviation: number;
    version: number;
  }>;

export const ledgerOf = async (fixture: Fixture, debateId: string) =>
  (await fixture.sql.unsafe(
    `select actor_id, ladder, rating_before, rating_after, calculation_version,
            occurred_at, season_id
       from rating_changes where debate_id = $1 order by rating_after desc`,
    [debateId],
  )) as Array<{
    actor_id: string;
    ladder: string;
    rating_before: number;
    rating_after: number;
    calculation_version: string;
    occurred_at: Date;
    season_id: string;
  }>;

type RatingContext = {
  readonly fixture: Fixture;
  readonly database: Database;
  /** Rates a debate through the adapter with the stub decision. */
  readonly rate: (
    debateId: string,
    decide?: RatingDecision,
  ) => ReturnType<Database['rateDebate']>;
  /**
   * A completed debate between two new debaters on a new format, in an
   * active season opened by the first call.
   */
  readonly seated: (
    overrides?: Partial<Parameters<typeof completedDebate>[1]>,
  ) => Promise<{
    readonly formatId: string;
    readonly seasonId: string;
    readonly debateId: string;
    readonly affirmative: string;
    readonly negative: string;
  }>;
  /** Registers debates and debaters whose rating rows must be removed. */
  readonly track: (debateIds: string[], actorIds: string[]) => void;
};

/**
 * Runs `body` over a database and a fixture, then removes every ledger row
 * of its debates and every rating row its debaters hold before the fixture
 * purges the rest.
 */
export const withRatings = (
  url: string,
  body: (context: RatingContext) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const database = createDatabase({ url, nextActorId: createId });
    const debates: string[] = [];
    const actors: string[] = [];
    const track = (debateIds: string[], actorIds: string[]) => {
      debates.push(...debateIds);
      actors.push(...actorIds);
    };
    let season: string | undefined;
    const seated: RatingContext['seated'] = async (overrides = {}) => {
      season ??= await activeSeason(fixture);
      const formatId = overrides.formatId ?? (await fixture.format());
      const affirmative = overrides.affirmative ?? (await fixture.actor());
      const negative = overrides.negative ?? (await fixture.actor());
      const debateId = await completedDebate(fixture, {
        ...overrides,
        formatId,
        affirmative,
        negative,
      });
      track([debateId], [affirmative, negative]);
      return { formatId, seasonId: season, debateId, affirmative, negative };
    };
    try {
      await body({
        fixture,
        database,
        rate: (debateId, decide = stub()) =>
          database.rateDebate({ debateId, changeIds: ids(), decide }),
        seated,
        track,
      });
    } finally {
      if (debates.length > 0) await trackRatings(fixture, debates);
      for (const actorId of actors)
        await fixture.sql.unsafe('delete from ratings where actor_id = $1', [
          actorId,
        ]);
      await database.close();
    }
  });

const ids = (): [string, string] => [createId(), createId()];
