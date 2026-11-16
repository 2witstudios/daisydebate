import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createDatabase } from '@daisy/db';
import type { SQL, TransactionSQL } from 'bun';
import type { SavepointTestDatabase } from '@daisy/db/testing';
import { noopErrorReporter } from '@daisy/observability';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import { lobbyPeopleViewSchema } from '@daisy/protocol/lobby/lobby-people-read';
import { createId } from '@paralleldrive/cuid2';
import { appDiscoverActor } from '../src/features/account/username-discovery';
import { createTabCommandRoute } from '../src/features/tab/command-route';
import {
  createLobbyPeopleRoute,
  lobbyPeoplePath,
} from '../src/features/tab/lobby-people-route';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { readLobbyPeople } from '../src/features/tab/reads/lobby-people';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { scriptClock, type Bot } from './tab-tournament.test-support';

/** Real personal-lobby fixture and its production HTTP/username boundaries. */
export async function lobbyPeopleFrame(
  database: SavepointTestDatabase,
  bots: readonly Bot[],
  sql: TransactionSQL,
  databaseUrl: string,
) {
  const [owner, delegate, staff, outsider, otherStaff] = bots as readonly [
    Bot,
    Bot,
    Bot,
    Bot,
    Bot,
  ];
  const common = {
    store: createTabStore(database),
    authorize,
    now: scriptClock().now,
    newId: createId,
  };
  const create = lobbyAdministrationCommand(common);
  await seedHostingGrant(sql, owner.userId);
  const lobbies: string[] = [];
  for (const name of ['People target', 'Other private people']) {
    const answer = await create(as(owner), {
      version: 1,
      commandId: createId(),
      expected: {},
      command: {
        type: 'create-lobby',
        owner: { kind: 'self' },
        name,
        handle: `people-${createId()}`,
        lobby: { kind: 'tournament', admitsMinors: false },
      },
    });
    if (answer.kind !== 'accepted') throw new Error('Personal lobby refused');
    lobbies.push(answer.receipt.aggregate.id);
  }
  const [lobbyId, otherId] = lobbies as [string, string];
  const roles = await sql<{ id: string; name: string }[]>`
  select id,name from roles where preset=true and name in ('Director','Staff','Coach')`;
  const roleId = (name: string) => {
    const role = roles.find((one) => one.name === name);
    if (!role) throw new Error('Preset role missing');
    return role.id;
  };
  const boundary = (bot: Bot) => ({
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => ({
      ...member,
      principal: {
        kind: 'user' as const,
        userId: bot.userId,
        actorId: bot.actorId,
      },
    }),
  });
  const read = readLobbyPeople(common);
  const get = (bot: Bot, target = lobbyId, released = true) =>
    createLobbyPeopleRoute({
      boundary: boundary(bot),
      released: async () => released,
      read,
    })(
      new Request(`${origin}${lobbyPeoplePath(target)}`, {
        headers: { origin },
      }),
    );
  const directory = createDatabase({
    url: databaseUrl,
    client: sql as SQL,
    nextActorId: createId,
  });
  const discoverySpends: string[] = [];
  const targets = {
    readPeople: read,
    discover: appDiscoverActor({
      database: directory,
      limiter: {
        consume: async (key) => {
          discoverySpends.push(key);
          return { allowed: true, retryAfterSeconds: 0 };
        },
      },
    }),
    userIdOfActor: directory.getActiveHumanUserIdByActorId,
  };
  const command = organizationCommand(common);
  const send = async (
    bot: Bot,
    target: OrganizationCommand,
    version: number,
    commandId = createId(),
  ) => {
    const response = await createTabCommandRoute({
      boundary: boundary(bot),
      released: async () => true,
      address: 'none',
      name: 'tab.organization.command',
      execute: command,
    })(
      new Request(`${origin}/api/tab/organization-command`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          commandId,
          expected: { lobby: version },
          command: target,
        }),
      }),
    );
    return { status: response.status, answer: await response.json() };
  };
  const grant = (
    target: string,
    userId: string,
    name: string,
  ): OrganizationCommand => ({
    type: 'give-grant',
    scope: { kind: 'lobby', lobbyId: target },
    userId,
    roleId: roleId(name),
    expiresAt: null,
  });
  const people = async (bot: Bot, target = lobbyId) => {
    const response = await get(bot, target);
    if (response.status !== 200)
      throw new Error(`People HTTP ${response.status}`);
    return lobbyPeopleViewSchema.parse(await response.json());
  };
  // A privileged witness prevents tenant RLS from turning hidden membership into false absence.
  const membershipCount = (userId: string) =>
    sql.savepoint(async (proof) => {
      const [before] = await proof`select current_user as role`;
      await proof`reset role`;
      try {
        const [count] =
          await proof`select count(*)::int as total from memberships where user_id=${userId}`;
        return Number(count!.total);
      } finally {
        await proof.unsafe(
          'set local role "' + String(before!.role).replaceAll('"', '""') + '"',
        );
      }
    });
  return {
    membershipCount,
    owner,
    delegate,
    staff,
    outsider,
    otherStaff,
    common,
    lobbyId,
    otherId,
    get,
    send,
    grant,
    people,
    targets,
    discoverySpends,
  };
}
