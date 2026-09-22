import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  at,
  columnNames,
  indexDefinition,
  rejected,
  withFixture,
} from './constraint-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

describe('seasons, ratings and the rating ledger (DATA-3.2)', () => {
  const season = (overrides: Record<string, unknown>) => ({
    id: createId(),
    name: 'Season',
    starts_at: at,
    ends_at: null,
    status: 'scheduled',
    ...overrides,
  });

  test('at most one active season', async () => {
    await withFixture(url, async (fixture) => {
      const firstActive = !(await fixture.rejects(
        'seasons',
        season({ status: 'active' }),
      ));
      const secondActive = await fixture.rejects(
        'seasons',
        season({ status: 'active' }),
      );
      const secondScheduled = !(await fixture.rejects('seasons', season({})));
      const badStatus = await fixture.rejects(
        'seasons',
        season({ status: 'paused' }),
      );
      assert({
        given: 'an active season already present',
        should:
          'reject a second active season and an unknown status, accept another scheduled one',
        actual: { firstActive, secondActive, secondScheduled, badStatus },
        expected: {
          firstActive: true,
          secondActive: true,
          secondScheduled: true,
          badStatus: true,
        },
      });
    });
  });

  test('ratings hold bounded Glicko-2 state and nothing derivable', async () => {
    await withFixture(url, async (fixture) => {
      const actorId = await fixture.actor();
      const formatId = await fixture.format();
      const seasonId = createId();
      await fixture.insert('seasons', season({ id: seasonId }));
      const rating = (overrides: Record<string, unknown>) => ({
        actor_id: actorId,
        format_id: formatId,
        season_id: seasonId,
        rating: 1500,
        deviation: 350,
        volatility: 0.06,
        ...overrides,
      });
      const tooHigh = await fixture.rejects(
        'ratings',
        rating({ rating: 4001 }),
        'actor_id',
      );
      const negative = await fixture.rejects(
        'ratings',
        rating({ rating: -1 }),
        'actor_id',
      );
      const zeroDeviation = await fixture.rejects(
        'ratings',
        rating({ deviation: 0 }),
        'actor_id',
      );
      const zeroVolatility = await fixture.rejects(
        'ratings',
        rating({ volatility: 0 }),
        'actor_id',
      );
      const accepted = !(await fixture.rejects(
        'ratings',
        rating({}),
        'actor_id',
      ));
      const duplicateKey = await fixture.rejects(
        'ratings',
        rating({ rating: 1600 }),
        'actor_id',
      );
      const columns = await columnNames(fixture, 'ratings');
      assert({
        given: 'rating rows at and beyond the Glicko-2 bounds',
        should:
          'accept one bounded row per (actor, format, season), reject the rest, and store no derived columns',
        actual: {
          tooHigh,
          negative,
          zeroDeviation,
          zeroVolatility,
          accepted,
          duplicateKey,
          derived: columns.filter((column) =>
            ['games_played', 'peak_rating', 'last_rated_at'].includes(column),
          ),
          leaderboard: (
            await indexDefinition(fixture, 'ratings_leaderboard_idx')
          )?.includes('(format_id, season_id, rating DESC'),
        },
        expected: {
          tooHigh: true,
          negative: true,
          zeroDeviation: true,
          zeroVolatility: true,
          accepted: true,
          duplicateKey: true,
          derived: [],
          leaderboard: true,
        },
      });
    });
  });

  test('the ledger records one change per debate and actor', async () => {
    await withFixture(url, async (fixture) => {
      const actorId = await fixture.actor();
      const formatId = await fixture.format();
      const seasonId = createId();
      await fixture.insert('seasons', season({ id: seasonId }));
      const debateId = await fixture.debate({ format: formatId });
      const change = (overrides: Record<string, unknown>) => ({
        id: createId(),
        debate_id: debateId,
        actor_id: actorId,
        format_id: formatId,
        season_id: seasonId,
        rating_before: 1500,
        rating_after: 1516,
        deviation_before: 350,
        deviation_after: 290,
        volatility_before: 0.06,
        volatility_after: 0.0599,
        calculation_version: 'glicko2-v1',
        occurred_at: at,
        ...overrides,
      });
      const accepted = !(await fixture.rejects('rating_changes', change({})));
      const secondForDebate = await fixture.rejects(
        'rating_changes',
        change({}),
      );
      const otherDebate = await fixture.debate({ format: formatId });
      const zeroDeviation = await fixture.rejects(
        'rating_changes',
        change({ debate_id: otherDebate, deviation_after: 0 }),
      );
      const negativeRating = await fixture.rejects(
        'rating_changes',
        change({ debate_id: otherDebate, rating_after: -1 }),
      );
      const debateDeleteBlocked = await rejected(() =>
        fixture.sql.unsafe('delete from debates where id = $1', [debateId]),
      );
      const history = await indexDefinition(
        fixture,
        'rating_changes_actor_format_occurred_idx',
      );
      assert({
        given: 'a rated debate with one ledger row',
        should:
          'reject a second row for the same debate and actor, a zero deviation and a negative rating; keep the debate undeletable; index the actor history',
        actual: {
          accepted,
          secondForDebate,
          zeroDeviation,
          negativeRating,
          debateDeleteBlocked,
          indexed: history?.includes('(actor_id, format_id, occurred_at)'),
        },
        expected: {
          accepted: true,
          secondForDebate: true,
          zeroDeviation: true,
          negativeRating: true,
          debateDeleteBlocked: true,
          indexed: true,
        },
      });
    });
  });
});
