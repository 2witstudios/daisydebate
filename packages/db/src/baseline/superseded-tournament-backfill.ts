import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { query, run } from '../raw-rows';
import type { Tx } from '../tx';

const legacyParentGroup = z.object({
  leagueId: z.string(),
  ageRule: z.enum(['adults', 'under-18']),
  tournaments: z.array(z.string()),
  candidates: z.array(z.string()),
});

/**
 * The old migrator's preparation for `_tournament_lobby_eligibility`:
 * historical parent links, in the same transaction as that folder. Only a
 * database built the old way (`migrateOldWay`) still runs it.
 */
export async function prepareTournamentLobbyBackfill(tx: Tx) {
  await run(
    tx,
    sql`lock table public.lobbies, public.settings in access exclusive mode`,
  );
  await run(
    tx,
    sql`
    create temp table tournament_lobby_backfill on commit drop as
      select lobby.id as tournament_id, lobby.owner_organization_id as league_id,
        (case when setting.value->>'value' = 'youth' then 'under-18'
          else 'adults' end)::public.lobby_age_rule as age_rule,
        null::text as parent_id
      from public.lobbies lobby
      left join public.settings setting
        on setting.scope_kind = 'lobby' and setting.lobby_id = lobby.id
        and setting.key = 'entry.age_division'
      where lobby.kind = 'tournament'
  `,
  );
  const groups = await query(
    tx,
    legacyParentGroup,
    sql`
    select legacy.league_id as "leagueId", legacy.age_rule as "ageRule",
      array_agg(legacy.tournament_id order by legacy.tournament_id) as tournaments,
      array(select parent.id from public.lobbies parent where
        parent.owner_organization_id = legacy.league_id and parent.kind = 'standing'
        and parent.age_rule = legacy.age_rule order by parent.id) as candidates
    from pg_temp.tournament_lobby_backfill legacy
    where legacy.league_id is not null
    group by legacy.league_id, legacy.age_rule
    order by legacy.league_id, legacy.age_rule
  `,
  );
  const ambiguous = groups.filter(({ candidates }) => candidates.length > 1);
  if (ambiguous.length)
    throw createAppError(
      'INVARIANT',
      `Tournament standing lobby selection is ambiguous: ${JSON.stringify(ambiguous)}`,
    );
  for (const { leagueId, ageRule, candidates } of groups) {
    let parentId = candidates[0];
    if (parentId === undefined) {
      parentId = createId();
      const name = ageRule === 'under-18' ? 'Youth' : 'Open';
      await run(
        tx,
        sql`
        insert into public.lobbies (id, kind, owner_organization_id, name, handle, age_rule)
        values (${parentId}, 'standing', ${leagueId}, ${name},
          ${`historical-${parentId}`}, ${ageRule}::public.lobby_age_rule)
      `,
      );
    }
    await run(
      tx,
      sql`
      update pg_temp.tournament_lobby_backfill set parent_id = ${parentId}
      where league_id = ${leagueId} and age_rule = ${ageRule}::public.lobby_age_rule
    `,
    );
  }
}
