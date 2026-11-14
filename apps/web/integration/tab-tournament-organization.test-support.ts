import type { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import type {
  CommandExpected,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import { CommandDenied } from '../src/features/tab/commands/run-command';
import {
  organizationCommand,
  type OrganizationCommandAnswer,
} from '../src/features/tab/operations/organization';
import { readOrganizationPeople } from '../src/features/tab/reads/organization-people';
import type { TabPrincipal } from '../src/features/tab/tab-principal';
import type { Bot, World } from './tab-tournament.test-support';

/**
 * Stage 1 of the scripted tournament: a Director makes a league, invites
 * Staff and a Coach, who accept, and gives Staff Daisy's preset Staff role.
 * Every step goes through the wired command and read, against stored state
 * under the web runtime role.
 */

/** Daisy's preset Staff role (the tab migration's seed). */
const presetStaffRoleId = 'lih2kkdou2a93bd7f8tgciko';

class StageFailed extends Error {}

const expect = (holds: boolean, what: string, actual?: unknown): void => {
  if (!holds)
    throw new StageFailed(
      `${what}${actual === undefined ? '' : `: ${JSON.stringify(actual)}`}`,
    );
};

const as = (bot: Bot): TabPrincipal => ({
  kind: 'user',
  userId: bot.userId,
  actorId: bot.actorId,
});

const envelope = (
  command: OrganizationCommand,
  expected: CommandExpected = {},
  commandId = createId(),
) => ({ version: 1 as const, commandId, expected, command });

const deniedAsNotFound = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch (error) {
    return error instanceof CommandDenied;
  }
};

/** Rows as the runtime role sees them under one organization's fence. */
const underFence = <Row>(
  world: World,
  organizationId: string,
  read: (sql: SQL) => Promise<unknown>,
): Promise<Row[]> =>
  world.sql.savepoint(async (sql) => {
    await sql`select set_config('daisy.organization_scope', ${organizationId}, true)`;
    return (await read(sql)) as Row[];
  });

type Cast = {
  readonly director: Bot;
  readonly staff: Bot;
  readonly coach: Bot;
};

/** What the stage drives: the wired command and people read over one store. */
const wiring = (world: World, cast: Cast) => {
  const store = createTabStore(world.database);
  return {
    store,
    send: organizationCommand({
      store,
      authorize,
      now: world.clock.now,
      newId: createId,
      // No hosting plan is stored yet; the Director holds one.
      hostingPlan: async (userId) => userId === cast.director.userId,
    }),
    people: readOrganizationPeople({ store, authorize, now: world.clock.now }),
  };
};
type Wiring = ReturnType<typeof wiring>;

const accepted = async (
  answer: Promise<OrganizationCommandAnswer>,
  what: string,
): Promise<LobbyCommandReceipt> => {
  const settled = await answer;
  if (settled.kind !== 'accepted')
    throw new StageFailed(`${what}: ${JSON.stringify(settled)}`);
  return settled.receipt;
};

/** The league made, its two members in, and the Staff role given. */
const formLeague = async ({ send }: Wiring, cast: Cast) => {
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
  const give: OrganizationCommand = {
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
type League = Awaited<ReturnType<typeof formLeague>>;

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

/** The same id replays its receipt; with another payload it is a conflict. */
const commandIdsReplay = async (
  { send }: Wiring,
  cast: Cast,
  { give, given, granted }: League,
) => {
  const replayed = await accepted(
    send(as(cast.director), given),
    'the replay is accepted',
  );
  expect(
    replayed.replayed && replayed.resultingVersion === granted.resultingVersion,
    'the same command id and payload replays its receipt',
    replayed,
  );
  const conflicting = await send(
    as(cast.director),
    envelope(
      { ...give, expiresAt: '2027-12-31T00:00:00.000Z' },
      given.expected,
      given.commandId,
    ),
  );
  expect(
    conflicting.kind === 'refused' &&
      conflicting.refusal === 'command-conflict',
    'the same command id with another payload is a command conflict',
    conflicting,
  );
};

/** One history entry per accepted command, and the grant names its giver. */
const recordStands = async (
  world: World,
  cast: Cast,
  { organizationId, given }: League,
  staffGrantId: string,
) => {
  const history = await underFence<{
    commandId: string;
    type: string;
    actorUserId: string | null;
    authority: string;
  }>(
    world,
    organizationId,
    (sql) => sql`select command_id as "commandId", type,
      actor_user_id as "actorUserId", authority from action_history
      where organization_id = ${organizationId} order by resulting_version`,
  );
  const step = (type: string, bot: Bot) => `${type} by ${bot.userId}`;
  expect(
    JSON.stringify(
      history.map((row) => `${row.type} by ${row.actorUserId}`),
    ) ===
      JSON.stringify([
        step('create-organization', cast.director),
        step('invite-member', cast.director),
        step('invite-member', cast.director),
        step('accept-membership', cast.staff),
        step('accept-membership', cast.coach),
        step('give-grant', cast.director),
      ]) &&
      history.at(-1)?.commandId === given.commandId &&
      history.at(-1)?.authority === 'owner',
    'one history entry per accepted command, naming who ran it and under what',
    history,
  );
  const [grant] = await underFence<{ grantedByUserId: string; userId: string }>(
    world,
    organizationId,
    (sql) => sql`select granted_by_user_id as "grantedByUserId",
      user_id as "userId" from grants where id = ${staffGrantId}`,
  );
  expect(
    grant?.grantedByUserId === cast.director.userId &&
      grant.userId === cast.staff.userId,
    'the grant names who gave it and to whom',
    grant,
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
};
