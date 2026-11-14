import type { TransactionSQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import {
  authorize,
  type AuthorizationCapability,
  type AuthorizationInput,
} from '@daisy/auth/authorization';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createTabStore, type OrganizationAuthority } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  accepted,
  as,
  envelope,
  wiring,
} from './tab-tournament-organization-wiring.test-support';
import {
  createBots,
  scriptClock,
  type Bot,
  type World,
} from './tab-tournament.test-support';

/**
 * A minor's boundary (TAB-8.2), as far as it is wired: the guardian rows a
 * parent's link and restriction leave, the boundary the Tab store always
 * loads with the account, and the evaluator fed by it. The guardian tables
 * stay closed to the runtime role (counsel), and the guardian commands are
 * not wired yet, so the rows are written as the migration owner; every
 * read runs as the web runtime role under its fence.
 */

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** A birth month that puts the account in the 16-17 band today. */
const seventeenYearsAgo = (): string => {
  const today = new Date();
  const month = String(today.getUTCMonth() + 1).padStart(2, '0');
  return `${today.getUTCFullYear() - 17}-${month}`;
};

const seedPeople = async (sql: TransactionSQL) => {
  const bots = await createBots(sql, ['Director', 'Parent', 'Minor']);
  const [director, parent, minor] = bots as [Bot, Bot, Bot];
  await sql`update account_age set birth_month = ${seventeenYearsAgo()}
    where user_id = ${minor.userId}`;
  return { director, parent, minor };
};

/** A league the Director makes through the wired command, with a standing lobby. */
const leagueWithLobby = async (
  world: World,
  send: ReturnType<typeof wiring>['send'],
  director: Bot,
  name: string,
) => {
  const created = await accepted(
    send(
      as(director),
      envelope({
        type: 'create-organization',
        kind: 'league',
        name,
        handle: `${name.toLowerCase()}-${createId().slice(0, 10)}`,
      }),
    ),
    `${name} is created`,
  );
  const organizationId = created.aggregate.id;
  const lobbyId = createId();
  await world.sql.savepoint(async (sql) => {
    await sql`select set_config('daisy.lobby_scope', ${lobbyId}, true)`;
    await sql`insert into lobbies (id, kind, owner_organization_id, name, handle)
      values (${lobbyId}, 'standing', ${organizationId}, ${`${name} Rooms`},
        ${`rooms-${lobbyId.slice(0, 10)}`})`;
  });
  return { organizationId, lobbyId };
};

/**
 * The parent's consented link and a restriction that allows one lobby,
 * written as the migration owner: the runtime role holds no write on the
 * guardian tables until counsel answers.
 */
const restrictTo = (
  world: World,
  parent: Bot,
  minor: Bot,
  lobbyId: string,
): Promise<void> =>
  world.sql.savepoint(async (sql) => {
    await sql`reset role`;
    const linkId = createId();
    await sql`insert into guardian_links
      (id, guardian_user_id, minor_user_id, kind, status)
      values (${linkId}, ${parent.userId}, ${minor.userId}, 'parent', 'active')`;
    await sql`insert into restrictions
      (guardian_link_id, guardian_user_id, minor_user_id, limits_lobbies)
      values (${linkId}, ${parent.userId}, ${minor.userId}, true)`;
    await sql`insert into restriction_lobbies
      (guardian_link_id, guardian_user_id, minor_user_id, lobby_id)
      values (${linkId}, ${parent.userId}, ${minor.userId}, ${lobbyId})`;
    await sql`update users set version = version + 1 where id = ${minor.userId}`;
    await sql`set local role daisy_web`;
  });

/** The organization and account the store loads for someone reading it. */
const loadedFor = async (
  store: ReturnType<typeof createTabStore>,
  viewer: Bot,
  organizationId: string,
) => {
  const view = await store.organizationPeople({
    viewerUserId: viewer.userId,
    organizationId,
  });
  if (view?.authorization.organization == null)
    throw new Error('the organization is not loaded');
  return {
    account: view.authorization.account,
    organization: view.authorization.organization,
  };
};

/**
 * The questions a minor asks of one standing lobby, its Rooms and its
 * people. The lobby's owner is the organization the store loaded. The
 * facts no Tab loader produces on this branch yet (who may view, what the
 * Room and Round hold, the lobby a counterpart shares) are the same for
 * both lobbies, so any difference is the boundary.
 */
const questionsOf = (
  minor: Bot,
  lobbyId: string,
  organization: OrganizationAuthority,
): readonly (readonly [
  string,
  AuthorizationCapability,
  AuthorizationInput['resource'],
  Partial<AuthorizationInput['context']>,
])[] => {
  const scope = {
    lobbyId,
    lobbyKind: 'standing' as const,
    owner: { kind: 'organization' as const, organization },
  };
  const lobby = {
    kind: 'lobby' as const,
    scope,
    viewing: { audiences: ['participants' as const], releases: [] },
    postingAudiences: ['public' as const],
  };
  const room = {
    kind: 'room' as const,
    roomId: createId(),
    hostActorId: createId(),
    visibility: 'public' as const,
    status: 'open',
    revision: 1,
    participants: [],
    owner: { kind: 'person' as const, scope },
  };
  const other = createId();
  return [
    ['see the lobby', 'lobby.read', lobby, {}],
    ['list its Rooms', 'room.list', lobby, {}],
    ['make a Room there', 'lobby.room.create', lobby, {}],
    ['see a Room', 'room.read', room, {}],
    ['join a Room', 'room.join', room, {}],
    [
      'watch a Round',
      'round.read',
      {
        kind: 'round',
        roundId: createId(),
        createdByActorId: room.hostActorId,
        visibility: 'public',
        status: 'live',
        participants: [],
        revision: 1,
        owner: room.owner,
      },
      {},
    ],
    [
      'message someone there',
      'channel.dm.request',
      {
        kind: 'social_creation',
        mode: 'dm',
        initiatorActorId: minor.actorId,
        recipientActorId: other,
        policyKey: 'social.dm',
        policyRevision: 1,
        contactPair: {
          lowActorId: minor.actorId < other ? minor.actorId : other,
          highActorId: minor.actorId < other ? other : minor.actorId,
          blocked: false,
          revision: 1,
        },
      },
      { counterparts: [{ actorId: other, lobbies: [scope] }] },
    ],
  ];
};

test("a minor's boundary, loaded with the account", async () => {
  const seen = await withRolledBackDatabase(databaseUrl, {
    seed: seedPeople,
    work: async (database, people, sql) => {
      const world: World = {
        database,
        sql,
        clock: scriptClock(),
        bots: {},
        made: new Map(),
      };
      const { director, parent, minor } = people;
      const { store, send } = wiring(world, {
        director,
        staff: parent,
        coach: minor,
      });
      const allowed = await leagueWithLobby(world, send, director, 'Allowed');
      const outside = await leagueWithLobby(world, send, director, 'Outside');
      const unbounded = await loadedFor(store, minor, allowed.organizationId);
      await restrictTo(world, parent, minor, allowed.lobbyId);
      const inside = await loadedFor(store, minor, allowed.organizationId);
      const beyond = await loadedFor(store, minor, outside.organizationId);
      const ask = (loaded: typeof inside, lobbyId: string): readonly string[] =>
        questionsOf(minor, lobbyId, loaded.organization).map(
          ([what, capability, resource, context]) => {
            const decision = authorize({
              principal: as(minor),
              capability,
              resource,
              context: { account: loaded.account, ...context },
            });
            return `${what}: ${decision.allow ? 'allowed' : decision.reason}`;
          },
        );
      const read = (loaded: typeof inside) =>
        authorize({
          principal: as(minor),
          capability: 'organization.read',
          resource: loaded.organization,
          context: { account: loaded.account },
        }).allow;
      return {
        before: unbounded.account?.boundary ?? null,
        boundary: inside.account?.boundary?.allowedLobbyIds,
        parentUnbounded:
          (await loadedFor(store, parent, allowed.organizationId)).account
            ?.boundary ?? null,
        reads: [read(inside), read(beyond)],
        inside: ask(inside, allowed.lobbyId),
        beyond: ask(beyond, outside.lobbyId),
        allowedLobbyId: allowed.lobbyId,
      };
    },
  });

  assert({
    given: 'a minor with no guardian link',
    should: 'have no boundary',
    actual: seen.before,
    expected: null,
  });
  assert({
    given: "a parent's restriction that allows one lobby",
    should: 'load that lobby as the boundary, and none on the parent',
    actual: [seen.boundary, seen.parentUnbounded],
    expected: [[seen.allowedLobbyId], null],
  });
  assert({
    given:
      'the organization that owns the allowed lobby, and one that does not',
    should: 'let the minor find only the first',
    actual: seen.reads,
    expected: [true, false],
  });
  assert({
    given: 'the allowed lobby',
    should:
      'let the minor see, list, make, see and join its Rooms, and never stop them at the boundary',
    actual: [
      seen.inside.slice(0, 5).every((line) => line.endsWith(': allowed')),
      seen.inside.filter((line) => line.endsWith('restricted')),
    ],
    expected: [true, []],
  });
  assert({
    given: 'a lobby outside the boundary',
    should: 'refuse the minor every question there as restricted',
    actual: seen.beyond,
    expected: questionsOf(
      { name: '', userId: createId(), actorId: createId() },
      createId(),
      {
        kind: 'organization',
        organizationId: createId(),
        organizationKind: 'league',
        ownerActorIds: [],
        member: false,
        standingLobbyIds: [],
      },
    ).map(([what]) => `${what}: restricted`),
  });
});
