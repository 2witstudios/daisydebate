import { authorize } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { lobbyGrantsComeAndGo } from './tab-tournament-lobby-grants.test-support';
import {
  commandIdTakenElsewhere,
  commandIdsReplay,
  recordStands,
} from './tab-tournament-organization-record.test-support';
import {
  accepted,
  as,
  deniedAsNotFound,
  envelope,
  expect,
  presetStaffRoleId,
  StageFailed,
  wiring,
  type Cast,
  type League,
  type Wiring,
} from './tab-tournament-organization-wiring.test-support';
import type { Bot, World } from './tab-tournament.test-support';

/**
 * Stage 1 of the scripted tournament: a Director makes a league, invites
 * Staff and a Coach, who accept, and gives Staff Daisy's preset Staff role;
 * then gives and removes a grant at one of the league's lobbies. Every step
 * goes through the wired command and read, against stored state under the
 * web runtime role.
 */

/** The league made, its two members in, and the Staff role given. */
const formLeague = async ({ send }: Wiring, cast: Cast): Promise<League> => {
  const created = await accepted(
    send(
      as(cast.director),
      envelope({
        type: 'create-organization',
        kind: 'league',
        name: 'Valley League',
        handle: `valley-${createId().slice(0, 10)}`,
      }),
    ),
    'the league is created',
  );
  const organizationId = created.aggregate.id;
  let version = created.resultingVersion;
  for (const bot of [cast.staff, cast.coach]) {
    const invited = await accepted(
      send(
        as(cast.director),
        envelope(
          { type: 'invite-member', organizationId, userId: bot.userId },
          { organization: version },
        ),
      ),
      `${bot.name} is invited`,
    );
    version = invited.resultingVersion;
  }
  for (const bot of [cast.staff, cast.coach]) {
    const joined = await accepted(
      send(as(bot), envelope({ type: 'accept-membership', organizationId })),
      `${bot.name} accepts`,
    );
    version = joined.resultingVersion;
  }
  const give: League['give'] = {
    type: 'give-grant',
    organizationId,
    userId: cast.staff.userId,
    roleId: presetStaffRoleId,
    scope: { kind: 'organization' },
    expiresAt: null,
  };
  const given = envelope(give, { organization: version });
  const granted = await accepted(
    send(as(cast.director), given),
    'Staff is given the Staff role',
  );
  return { organizationId, give, given, granted };
};

/** The Director reads the people from stored state; answers Staff's grant id. */
const directorReadsPeople = async (
  { people }: Wiring,
  cast: Cast,
  { organizationId }: League,
): Promise<string> => {
  const seen = await people(as(cast.director), organizationId);
  if (seen === null) throw new StageFailed('the Director reads no people');
  const shown = (bot: Bot) => {
    const person = seen.people.find((one) => one.userId === bot.userId);
    return person === undefined
      ? null
      : {
          owner: person.owner,
          membership: person.membership,
          removable: person.removable,
          roles: person.grants.map((grant) => grant.roleId),
        };
  };
  expect(
    JSON.stringify([shown(cast.director), shown(cast.staff)]) ===
      JSON.stringify([
        { owner: true, membership: 'active', removable: false, roles: [] },
        {
          owner: false,
          membership: 'active',
          removable: true,
          roles: [presetStaffRoleId],
        },
      ]) &&
      seen.roles.some((role) => role.roleId === presetStaffRoleId) &&
      seen.capabilities.give,
    'the Director reads Director and Staff with the Staff role',
    seen,
  );
  const grant = seen.people.find((one) => one.userId === cast.staff.userId)
    ?.grants[0];
  if (grant === undefined) throw new StageFailed('Staff holds no grant');
  return grant.grantId;
};

/** Staff reads as a host under the grant, and is denied what it does not hold. */
const staffActsAsStaff = async (
  { store, send, people }: Wiring,
  cast: Cast,
  { organizationId, give, granted }: League,
  staffGrantId: string,
  now: string,
) => {
  const view = await store.organizationPeople({
    viewerUserId: cast.staff.userId,
    organizationId,
  });
  const organization = view?.authorization.organization ?? null;
  if (view === null || organization === null)
    throw new StageFailed('Staff loads the organization');
  const hostRead = authorize({
    principal: as(cast.staff),
    capability: 'organization.host.read',
    resource: organization,
    context: {
      account: view.authorization.account,
      now,
      grants: view.authorization.grants,
    },
  });
  expect(
    hostRead.allow &&
      hostRead.authority.kind === 'grant' &&
      hostRead.authority.grantId === staffGrantId,
    'Staff reads as a host under the Staff grant',
    hostRead,
  );
  expect(
    (await people(as(cast.staff), organizationId)) !== null,
    'Staff reads the people',
  );
  expect(
    (await people(as(cast.coach), organizationId)) === null,
    'a member with no grant cannot read the people',
  );
  expect(
    await deniedAsNotFound(() =>
      send(
        as(cast.staff),
        envelope(
          { ...give, userId: cast.coach.userId },
          { organization: granted.resultingVersion },
        ),
      ),
    ),
    'Staff, who does not manage roles, is answered not found',
  );
};

export const organizationStage = async (world: World): Promise<void> => {
  const { Director: director, Staff: staff, Coach: coach } = world.bots;
  if (!director || !staff || !coach) throw new StageFailed('bots missing');
  const cast = { director, staff, coach };
  const wired = wiring(world, cast);
  const league = await formLeague(wired, cast);
  world.made.set('league', league.organizationId);
  const staffGrantId = await directorReadsPeople(wired, cast, league);
  await staffActsAsStaff(wired, cast, league, staffGrantId, world.clock.now());
  await commandIdsReplay(wired, cast, league);
  await recordStands(world, cast, league, staffGrantId);
  await lobbyGrantsComeAndGo(world, wired, cast, league);
  await commandIdTakenElsewhere(world, wired, cast, league);
};
