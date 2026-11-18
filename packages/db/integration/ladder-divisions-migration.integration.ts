import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
import { ladderKey, winnerOutcome, type RatingState } from '@daisy/protocol';
import { SQL } from 'bun';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migration = '20261118063405_ladder_divisions';
const scratch = scratchDatabase(url, 'ladderdivisions');

afterAll(() => scratch.drop());

const stateOf = (row: {
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
}): RatingState => ({
  rating: row.rating,
  deviation: row.deviation,
  volatility: row.volatility,
});

type LedgerRow = {
  readonly round_id: string;
  readonly actor_id: string;
  readonly ladder: string;
  readonly division: string;
  readonly rating_before: number;
  readonly rating_after: number;
  readonly deviation_before: number;
  readonly deviation_after: number;
  readonly volatility_before: number;
  readonly volatility_after: number;
  readonly occurred_at: Date;
};

test(
  'existing ratings move to Open – Freestyle with no value changed, and the ledger replays to them (ADR 0147)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    // The scratch database is dropped whole, so nothing here purges rows.
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const seasonId = createId();
      await f.insert('seasons', {
        id: seasonId,
        name: 'Season 1',
        activation_key: 'beta-season-1',
        starts_at: new Date('2026-10-01'),
        status: 'active',
      });
      // Three debaters play three rated Freestyle Rounds, posted exactly as
      // the rating writer posts them: the engine's decision, ledger and
      // projection together.
      const debaters = [await f.actor(), await f.actor(), await f.actor()];
      const projection = new Map<string, RatingState>();
      const lastRated = new Map<string, string>();
      const games = [
        [0, 1, 'affirmative', '2026-10-02T12:00:00.000Z'],
        [1, 2, 'negative', '2026-10-03T12:00:00.000Z'],
        [2, 0, 'affirmative', '2026-10-05T12:00:00.000Z'],
      ] as const;
      for (const [aff, neg, winner, occurredAt] of games) {
        const roundId = await f.round({
          competition_type: 'ranked',
          ladder_id: 'freestyle',
          format_id: 'freestyle',
          preset_version: 1,
        });
        const affirmative = debaters[aff]!;
        const negative = debaters[neg]!;
        await f.participant(roundId, 'affirmative', 0, affirmative);
        await f.participant(roundId, 'negative', 0, negative);
        const rated = rateDebate({
          affirmative: {
            state: projection.get(affirmative) ?? ratingPolicy.initial,
            lastRatedAt: lastRated.get(affirmative) ?? null,
          },
          negative: {
            state: projection.get(negative) ?? ratingPolicy.initial,
            lastRatedAt: lastRated.get(negative) ?? null,
          },
          outcome: winnerOutcome(winner),
          occurredAt,
        });
        for (const [actorId, side] of [
          [affirmative, rated.affirmative],
          [negative, rated.negative],
        ] as const) {
          await f.insert('rating_changes', {
            id: createId(),
            round_id: roundId,
            actor_id: actorId,
            format_id: 'freestyle',
            ladder: 'freestyle',
            season_id: seasonId,
            rating_before: side.before.rating,
            rating_after: side.after.rating,
            deviation_before: side.before.deviation,
            deviation_after: side.after.deviation,
            volatility_before: side.before.volatility,
            volatility_after: side.after.volatility,
            calculation_version: rated.calculationVersion,
            occurred_at: new Date(occurredAt),
          });
          projection.set(actorId, side.after);
          lastRated.set(actorId, occurredAt);
        }
      }
      for (const [actorId, state] of projection)
        await f.insert(
          'ratings',
          {
            actor_id: actorId,
            ladder: 'freestyle',
            season_id: seasonId,
            ...state,
          },
          'actor_id',
        );
      const casualRound = await f.round({ format_id: 'freestyle' });
      const challengeIds = { ranked: createId(), casual: createId() };
      for (const [mode, id] of Object.entries(challengeIds))
        await f.insert('challenges', {
          id,
          challenger_actor_id: debaters[0],
          challenged_actor_id: debaters[mode === 'ranked' ? 1 : 2],
          mode,
          format_id: 'freestyle',
          created_at: new Date('2026-10-02'),
          expires_at: new Date('2099-10-03'),
        });

      const ratingsBefore = await f.sql`
        select to_jsonb(r) as row from ratings r order by actor_id`;
      const ledgerBefore = await f.sql`
        select to_jsonb(c) as row from rating_changes c order by id`;

      await scratch.migrate(() => true);

      const without = (
        rows: readonly { row: Record<string, unknown> }[],
        column: string,
      ) =>
        rows.map(({ row }) =>
          Object.fromEntries(
            Object.entries(row).filter(([name]) => name !== column),
          ),
        );
      const ratingsAfter = await f.sql`
        select to_jsonb(r) as row from ratings r order by actor_id`;
      const ledgerAfter = await f.sql`
        select to_jsonb(c) as row from rating_changes c order by id`;
      assert({
        given: 'every rating and ledger row from before the migration',
        should:
          'keep every stored value exactly, the division the only new column',
        actual: {
          ratings: without(ratingsAfter, 'division'),
          ledger: without(ledgerAfter, 'division'),
        },
        expected: {
          ratings: ratingsBefore.map(({ row }: { row: unknown }) => row),
          ledger: ledgerBefore.map(({ row }: { row: unknown }) => row),
        },
      });
      assert({
        given: 'the migrated rows',
        should:
          'put every season, rating, ledger row, ranked Round and ranked challenge on Open, and leave casual ones without a division',
        actual: {
          seasons:
            await f.sql`select division from seasons where id=${seasonId}`,
          ratings: (await f.sql`select distinct division from ratings`).length,
          ratingDivision: (
            await f.sql`select distinct division from ratings`
          )[0],
          ledger: await f.sql`select distinct division from rating_changes`,
          rankedRounds:
            await f.sql`select distinct ladder_division from rounds where ladder_id is not null`,
          casualRound:
            await f.sql`select ladder_division from rounds where id=${casualRound}`,
          challenges:
            await f.sql`select mode, division from challenges order by mode`,
        },
        expected: {
          seasons: [{ division: 'open' }],
          ratings: 1,
          ratingDivision: { division: 'open' },
          ledger: [{ division: 'open' }],
          rankedRounds: [{ ladder_division: 'open' }],
          casualRound: [{ ladder_division: null }],
          challenges: [
            { mode: 'casual', division: null },
            { mode: 'ranked', division: 'open' },
          ],
        },
      });

      // Replay the migrated ledger per ladder (style, division) and Round,
      // in posting order, through the same Glicko-2 decision.
      const ledger = (await f.sql`
        select c.*, p.side from rating_changes c
          join round_participants p on p.round_id = c.round_id and p.actor_id = c.actor_id
         order by c.occurred_at, c.round_id, p.side`) as (LedgerRow & {
        side: 'affirmative' | 'negative';
      })[];
      const replayed = new Map<string, RatingState>();
      const replayedAt = new Map<string, string>();
      const mismatches: string[] = [];
      const roundIds = [...new Set(ledger.map((row) => row.round_id))];
      for (const roundId of roundIds) {
        const rows = ledger.filter((row) => row.round_id === roundId);
        const aff = rows.find((row) => row.side === 'affirmative')!;
        const neg = rows.find((row) => row.side === 'negative')!;
        const key = (row: LedgerRow) =>
          `${ladderKey(row.ladder, row.division as 'open')}:${row.actor_id}`;
        const occurredAt = aff.occurred_at.toISOString();
        const won = aff.rating_after > aff.rating_before;
        const rated = rateDebate({
          affirmative: {
            state: replayed.get(key(aff)) ?? ratingPolicy.initial,
            lastRatedAt: replayedAt.get(key(aff)) ?? null,
          },
          negative: {
            state: replayed.get(key(neg)) ?? ratingPolicy.initial,
            lastRatedAt: replayedAt.get(key(neg)) ?? null,
          },
          outcome: winnerOutcome(won ? 'affirmative' : 'negative'),
          occurredAt,
        });
        for (const [row, side] of [
          [aff, rated.affirmative],
          [neg, rated.negative],
        ] as const) {
          if (
            side.after.rating !== row.rating_after ||
            side.after.deviation !== row.deviation_after ||
            side.after.volatility !== row.volatility_after
          )
            mismatches.push(`${roundId}:${row.actor_id}`);
          replayed.set(key(row), side.after);
          replayedAt.set(key(row), occurredAt);
        }
      }
      const stored = (await f.sql`
        select actor_id, ladder, division, rating, deviation, volatility from ratings`) as {
        actor_id: string;
        ladder: string;
        division: 'open';
        rating: number;
        deviation: number;
        volatility: number;
      }[];
      assert({
        given: 'the migrated ledger replayed per ladder through Glicko-2',
        should:
          'reproduce every posting and every stored rating on Open – Freestyle exactly',
        actual: {
          mismatches,
          projections: stored.map((row) =>
            replayed.get(
              `${ladderKey(row.ladder, row.division)}:${row.actor_id}`,
            ),
          ),
        },
        expected: {
          mismatches: [],
          projections: stored.map(stateOf),
        },
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
