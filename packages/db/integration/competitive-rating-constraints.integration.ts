import { publicLobbyId } from '../src/daisy-reference';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  at,
  columnNames,
  indexDefinition,
  rejected,
  withFixture,
  type Fixture,
} from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const youthLadder = async (fixture: Fixture) => {
  const [found] =
    await fixture.sql`select d.id from ladders d join lobbies l on l.id=d.lobby_id
    where l.age_rule='under-18' order by l.created_at, l.id limit 1`;
  return found!.id;
};

describe('seasons, ratings and the rating ledger (DATA-3.2)', () => {
  const season = (overrides: Record<string, unknown>) => ({
    id: createId(),
    name: 'Season',
    lobby_id: publicLobbyId,
    starts_at: at,
    ends_at: null,
    status: 'closed',
    ...overrides,
  });
  /** An actor, a format and a season for rating rows to reference. */
  const rated = async (fixture: Fixture) => {
    const actorId = await fixture.actor();
    const formatId = await fixture.format();
    const seasonId = createId();
    await fixture.insert('seasons', season({ id: seasonId }));
    return { actorId, formatId, seasonId };
  };

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
      const secondClosed = !(await fixture.rejects('seasons', season({})));
      const badStatus = await fixture.rejects(
        'seasons',
        season({ status: 'paused' }),
      );
      assert({
        given: 'an active season already present',
        should:
          'reject a second active season and an unknown status, accept another closed one',
        actual: { firstActive, secondActive, secondClosed, badStatus },
        expected: {
          firstActive: true,
          secondActive: true,
          secondClosed: true,
          badStatus: true,
        },
      });
    });
  });

  test('ratings hold bounded Glicko-2 state and nothing derivable', async () => {
    await withFixture(url, async (fixture) => {
      const { actorId, seasonId } = await rated(fixture);
      const rating = (overrides: Record<string, unknown>) => ({
        actor_id: actorId,
        season_id: seasonId,
        ladder: 'freestyle',
        lobby_id: publicLobbyId,
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
      const nanDeviation = await fixture.rejectedBy(
        'ratings',
        rating({ deviation: 'NaN' }),
        'actor_id',
      );
      const infiniteVolatility = await fixture.rejectedBy(
        'ratings',
        rating({ volatility: 'Infinity' }),
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
      const quickLadder = await fixture.rejectedBy(
        'ratings',
        rating({ ladder: 'quick' }),
        'actor_id',
      );
      const unknownLadder = await fixture.rejectedBy(
        'ratings',
        rating({ ladder: 'blitz' }),
        'actor_id',
      );
      const unknownLobby = await fixture.rejectedBy(
        'ratings',
        rating({ lobby_id: 'missing' }),
        'actor_id',
      );
      const foreignLadder = await fixture.rejectedBy(
        'ratings',
        rating({
          ladder: await youthLadder(fixture),
          actor_id: await fixture.actor(),
        }),
        'actor_id',
      );
      const columns = await columnNames(fixture, 'ratings');
      assert({
        given: 'rating rows at and beyond the Glicko-2 bounds',
        should:
          'accept one bounded row per (actor, ladder, season), reject the rest, the retired quick ladder (DEC-238), unknown ladders and divisions and a row on another division’s season, and store no derived columns',
        actual: {
          tooHigh,
          negative,
          zeroDeviation,
          zeroVolatility,
          nanDeviation,
          infiniteVolatility,
          accepted,
          duplicateKey,
          quickLadder,
          unknownLadder,
          unknownLobby: typeof unknownLobby === 'string',
          foreignLadder,
          derived: columns.filter((column) =>
            ['games_played', 'peak_rating', 'last_rated_at'].includes(column),
          ),
          leaderboard: (
            await indexDefinition(fixture, 'ratings_leaderboard_idx')
          )?.includes('(season_id, ladder, rating DESC'),
        },
        expected: {
          tooHigh: true,
          negative: true,
          zeroDeviation: true,
          zeroVolatility: true,
          nanDeviation: 'ratings_deviation_positive',
          infiniteVolatility: 'ratings_volatility_positive',
          accepted: true,
          duplicateKey: true,
          quickLadder: 'ratings_ladder_lobby_fk',
          unknownLadder: 'ratings_ladder_lobby_fk',
          unknownLobby: true,
          foreignLadder: 'ratings_ladder_lobby_fk',
          derived: [],
          leaderboard: true,
        },
      });
    });
  });

  test('the ledger records one change per debate and actor', async () => {
    await withFixture(url, async (fixture) => {
      const { actorId, seasonId } = await rated(fixture);
      // A ledger row stands only on a rated Round of its own ladder (ADR 0147).
      const formatId = 'freestyle';
      // Freestyle's own catalog preset: a fixture preset would be purged with it.
      const rankedRound = async () =>
        fixture.round({
          format_id: formatId,
          competition_type: 'ranked',
          preset_version: 1,
          ladder_id: 'freestyle',
          season_id: seasonId,
          rating_lobby_id: publicLobbyId,
        });
      const roundId = await rankedRound();
      await fixture.participant(roundId, 'affirmative', 0, actorId);
      const change = (overrides: Record<string, unknown>) => ({
        id: createId(),
        round_id: roundId,
        actor_id: actorId,
        format_id: formatId,
        season_id: seasonId,
        ladder: 'freestyle',
        lobby_id: publicLobbyId,
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
      const otherDebate = await rankedRound();
      await fixture.participant(otherDebate, 'affirmative', 0, actorId);
      const casualDebate = await fixture.round({ format_id: formatId });
      await fixture.participant(casualDebate, 'affirmative', 0, actorId);
      const casualRound = await fixture.rejectedBy(
        'rating_changes',
        change({ round_id: casualDebate }),
      );
      const anotherSeasonId = createId();
      await fixture.insert('seasons', season({ id: anotherSeasonId }));
      const wrongSeason = await fixture.rejectedBy(
        'rating_changes',
        change({ round_id: otherDebate, season_id: anotherSeasonId }),
      );
      const nonParticipant = await fixture.rejectedBy(
        'rating_changes',
        change({ round_id: otherDebate, actor_id: await fixture.actor() }),
      );
      const foreignFormat = await fixture.rejectedBy(
        'rating_changes',
        change({ round_id: otherDebate, format_id: await fixture.format() }),
      );
      const nanDeviation = await fixture.rejectedBy(
        'rating_changes',
        change({ round_id: otherDebate, deviation_after: 'NaN' }),
      );
      const zeroDeviation = await fixture.rejects(
        'rating_changes',
        change({ round_id: otherDebate, deviation_after: 0 }),
      );
      const negativeRating = await fixture.rejects(
        'rating_changes',
        change({ round_id: otherDebate, rating_after: -1 }),
      );
      const unknownLadder = await fixture.rejectedBy(
        'rating_changes',
        change({ round_id: otherDebate, ladder: 'blitz' }),
      );
      const debateDeleteBlocked = await rejected(() =>
        fixture.sql.unsafe('delete from rounds where id = $1', [roundId]),
      );
      const history = await indexDefinition(
        fixture,
        'rating_changes_actor_format_occurred_idx',
      );
      assert({
        given: 'a rated debate with one ledger row',
        should:
          'reject a second row for the same debate and actor, a non-participant, a foreign format, non-finite or zero deviation and a negative rating and an unknown ladder; keep the debate undeletable; index the actor history',
        actual: {
          accepted,
          secondForDebate,
          nonParticipant,
          foreignFormat,
          nanDeviation,
          zeroDeviation,
          negativeRating,
          unknownLadder,
          casualRound,
          wrongSeason,
          debateDeleteBlocked,
          indexed: history?.includes(
            '(actor_id, format_id, ladder, occurred_at)',
          ),
        },
        expected: {
          accepted: true,
          secondForDebate: true,
          nonParticipant: 'rating_changes_participant_fk',
          foreignFormat: 'rating_changes_round_format_fk',
          nanDeviation: 'rating_changes_deviation_positive',
          zeroDeviation: true,
          negativeRating: true,
          unknownLadder: 'rating_changes_ladder_lobby_fk',
          casualRound: 'rating_changes_round_pool_fk',
          wrongSeason: 'rating_changes_round_pool_fk',
          debateDeleteBlocked: true,
          indexed: true,
        },
      });
    });
  });
});
