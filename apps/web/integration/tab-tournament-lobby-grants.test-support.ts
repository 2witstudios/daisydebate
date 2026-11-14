import { createId } from '@paralleldrive/cuid2';
import {
  accepted,
  as,
  envelope,
  expect,
  StageFailed,
  underFence,
  type Cast,
  type League,
  type Wiring,
} from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';

/**
 * The organization stage's lobby grants: Staff, given the Staff role at
 * one of the league's lobbies, shows it in the people read, and the
 * Director removes it again. The `grants` fence shows a lobby's grants
 * only under that lobby's scope, so both steps prove the store visits it.
 */

const lobbyName = 'Valley Rooms';

/**
 * The league's standing lobby, written under the lobby's fence as the
 * runtime role. Lobby commands are the next stage's to wire; this stage
 * needs only the row a lobby grant names.
 */
const standingLobby = async (
  world: World,
  organizationId: string,
): Promise<string> => {
  const lobbyId = createId();
  await world.sql.savepoint(async (sql) => {
    await sql`select set_config('daisy.lobby_scope', ${lobbyId}, true)`;
    await sql`insert into lobbies (id, kind, owner_organization_id, name, handle)
      values (${lobbyId}, 'standing', ${organizationId}, ${lobbyName},
        ${`valley-rooms-${lobbyId.slice(0, 10)}`})`;
  });
  return lobbyId;
};

/** Staff's grants as the Director reads them: role and where each holds. */
const staffGrantsSeen = async (
  { people }: Wiring,
  cast: Cast,
  organizationId: string,
) => {
  const seen = await people(as(cast.director), organizationId);
  if (seen === null) throw new StageFailed('the Director reads no people');
  return (
    seen.people.find((person) => person.userId === cast.staff.userId)?.grants ??
    []
  );
};

export const lobbyGrantsComeAndGo = async (
  world: World,
  wired: Wiring,
  cast: Cast,
  { organizationId, give, granted }: League,
) => {
  const lobbyId = await standingLobby(world, organizationId);
  await accepted(
    wired.send(
      as(cast.director),
      envelope(
        { ...give, scope: { kind: 'lobby', lobbyId } },
        { organization: granted.resultingVersion },
      ),
    ),
    'Staff is given the Staff role at the lobby',
  );
  const both = await staffGrantsSeen(wired, cast, organizationId);
  const atLobby = both.find((grant) => grant.scope.kind === 'lobby');
  expect(
    both.length === 2 &&
      both.some((grant) => grant.scope.kind === 'organization') &&
      JSON.stringify(atLobby?.scope) ===
        JSON.stringify({ kind: 'lobby', lobbyId, name: lobbyName }) &&
      atLobby?.roleId === give.roleId,
    'the people read shows Staff at the league and at the lobby',
    both,
  );
  if (atLobby === undefined) throw new StageFailed('no lobby grant');
  await accepted(
    wired.send(
      as(cast.director),
      envelope({
        type: 'remove-grant',
        organizationId,
        grantId: atLobby.grantId,
      }),
    ),
    "the Director removes Staff's lobby grant",
  );
  const left = await staffGrantsSeen(wired, cast, organizationId);
  const [row] = await underFence<{ revokedByUserId: string | null }>(
    world,
    { lobbyId },
    (sql) => sql`select revoked_by_user_id as "revokedByUserId"
      from grants where id = ${atLobby.grantId}`,
  );
  expect(
    left.length === 1 &&
      left[0]?.scope.kind === 'organization' &&
      row?.revokedByUserId === cast.director.userId,
    'the lobby grant is revoked by the Director; the league grant stays',
    { left, row },
  );
};
