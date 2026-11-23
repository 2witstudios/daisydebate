import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { daisyOrganizationId, publicLobbyId } from '../src/daisy-reference';
import { sqlStateOf } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** Carries what a transaction read out of the rollback that discards its rows. */
class RollbackWith extends Error {
  constructor(readonly value: unknown) {
    super('rollback');
  }
}

test('the web role scoped to one lobby reads and writes only that lobby’s rating pool', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    const outcome = await sql
      .begin(async (tx) => {
        const [youth] = (await tx`select d.id as ladder, d.lobby_id
          from ladders d join lobbies l on l.id = d.lobby_id
          where l.owner_organization_id = ${daisyOrganizationId}
            and l.age_rule = 'under-18'`) as {
          ladder: string;
          lobby_id: string;
        }[];
        const actor = createId();
        const pools = [
          { ladder: 'freestyle', lobby: publicLobbyId, season: createId() },
          { ladder: youth!.ladder, lobby: youth!.lobby_id, season: createId() },
        ];
        // The parents are not the subject: seed the pool rows alone.
        await tx`set local session_replication_role = replica`;
        for (const pool of pools) {
          await tx`insert into ratings
            (actor_id, ladder, lobby_id, season_id, rating, deviation, volatility)
            values (${actor}, ${pool.ladder}, ${pool.lobby}, ${pool.season}, 1500, 350, 0.06)`;
          await tx`insert into rating_changes
            (id, round_id, actor_id, format_id, season_id, ladder, lobby_id,
             rating_before, rating_after, deviation_before, deviation_after,
             volatility_before, volatility_after, calculation_version, occurred_at)
            values (${createId()}, ${createId()}, ${actor}, 'freestyle', ${pool.season},
              ${pool.ladder}, ${pool.lobby}, 1500, 1516, 350, 300, 0.06, 0.06,
              'glicko2-v1', now())`;
        }
        await tx`set local session_replication_role = origin`;
        await tx`set local role daisy_web`;
        await tx`select set_config('daisy.lobby_scope', ${publicLobbyId}, true)`;
        const ratings = (
          await tx`select distinct lobby_id from ratings where actor_id = ${actor}`
        ).map((row: { lobby_id: string }) => row.lobby_id);
        const ledger = (
          await tx`select distinct lobby_id from rating_changes where actor_id = ${actor}`
        ).map((row: { lobby_id: string }) => row.lobby_id);
        const updated = (
          await tx`update ratings set rating = 1700
            where actor_id = ${actor} and lobby_id = ${youth!.lobby_id} returning actor_id`
        ).length;
        const denied = await sqlStateOf(() =>
          tx.savepoint(
            (sp) => sp`insert into ratings
              (actor_id, ladder, lobby_id, season_id, rating, deviation, volatility)
              values (${createId()}, ${youth!.ladder}, ${youth!.lobby_id}, ${pools[1]!.season}, 1500, 350, 0.06)`,
          ),
        );
        throw new RollbackWith({ ratings, ledger, updated, denied });
      })
      .catch((error: unknown) => {
        if (error instanceof RollbackWith) return error.value;
        throw error;
      });
    assert({
      given:
        'ratings and postings in the Open and Youth pools, read and written by daisy_web scoped to Open',
      should: 'read Open only and refuse writes to the other pool',
      actual: outcome,
      expected: {
        ratings: [publicLobbyId],
        ledger: [publicLobbyId],
        updated: 0,
        denied: '42501',
      },
    });
  } finally {
    await sql.close();
  }
});
