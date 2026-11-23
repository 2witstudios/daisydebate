import { seasonStatuses } from './schema/seasons';
import { lobbyKinds } from '@daisy/protocol/lobby';
import { listedValue, listedLiteral } from './lifecycle-sql';
import type { SQL } from 'bun';
import type { LobbyAgeRule } from '@daisy/protocol/lobby/eligibility';
import { daisyOrganizationId } from './daisy-reference';

/** Fixture setup for rating journeys on the reference lobbies. */
export async function seedRatingSeason(
  client: SQL,
  id: string,
  ageRule: LobbyAgeRule = 'adults',
): Promise<{ readonly id: string; readonly lobbyId: string }> {
  const [lobby] = await client<{ id: string }[]>`
    select id from lobbies where owner_organization_id=${daisyOrganizationId}
      and kind=${listedValue(lobbyKinds, 'standing')} and age_rule=${ageRule}
    order by created_at, id limit 1`;
  if (!lobby) throw new Error('Rating fixture lobby is missing');
  // The conflict target must match the partial index's predicate literally.
  const active = listedLiteral(seasonStatuses, 'active');
  await client.unsafe(
    `insert into seasons (id, lobby_id, organization_id, name, starts_at, status)
    values ($1, $2, $3, 'Season 1', statement_timestamp(), ${active})
    on conflict (lobby_id) where status=${active} do nothing`,
    [id, lobby.id, daisyOrganizationId],
  );
  const [season] = await client<{ id: string; lobbyId: string }[]>`
    select id, lobby_id as "lobbyId" from seasons where lobby_id=${lobby.id} and status=${listedValue(seasonStatuses, 'active')}`;
  if (!season) throw new Error('Rating fixture season is missing');
  return season;
}
