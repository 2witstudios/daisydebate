import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import type {
  CommandExpected,
  LobbyCommandAnswer,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import type { OrganizationCommand } from '@daisy/protocol/lobby/organization-command';
import { organizationPeopleViewSchema } from '@daisy/protocol/lobby/organization-read';
import { createId } from '@paralleldrive/cuid2';
import type { SQL } from 'bun';
import { CommandDenied } from '../src/features/tab/commands/run-command';
import { readOrganizationPeople } from '../src/features/tab/reads/organization-people';
import type { TabPrincipal } from '../src/features/tab/tab-principal';
import { inTabTestTransaction } from './tab-test-transaction.test-support';
import {
  readTab,
  tabCommand,
  TournamentHttpError,
} from './tab-tournament-transport.test-support';
import type { Bot, World } from './tab-tournament.test-support';

/**
 * What the organization stage drives and asserts with: the wired command
 * and people read over one store, as the bots, and rows read under a fence.
 */

/** Daisy's preset Staff role (the tab migration's seed). */
export const presetStaffRoleId = 'lih2kkdou2a93bd7f8tgciko';

export class StageFailed extends Error {}

export const expect = (
  holds: boolean,
  what: string,
  actual?: unknown,
): void => {
  if (!holds)
    throw new StageFailed(
      `${what}${actual === undefined ? '' : `: ${JSON.stringify(actual)}`}`,
    );
};

export const as = (bot: Bot): TabPrincipal => ({
  kind: 'user',
  userId: bot.userId,
  actorId: bot.actorId,
});

export const envelope = (
  command: OrganizationCommand,
  expected: CommandExpected = {},
  commandId = createId(),
) => ({ version: 1 as const, commandId, expected, command });

export const deniedAsNotFound = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch (error) {
    return (
      error instanceof CommandDenied ||
      (error instanceof TournamentHttpError && error.status === 404)
    );
  }
};

/** Rows as the runtime role sees them under one tenant's fence. */
export const underFence = <Row>(
  world: World,
  scope: { readonly organizationId?: string; readonly lobbyId?: string },
  read: (sql: SQL) => Promise<unknown>,
): Promise<Row[]> =>
  inTabTestTransaction(world.sql, async (sql) => {
    await sql`set local role daisy_web`;
    await sql`select
      set_config('daisy.organization_scope', ${scope.organizationId ?? ''}, true),
      set_config('daisy.lobby_scope', ${scope.lobbyId ?? ''}, true)`;
    return (await read(sql)) as Row[];
  });

export type Cast = {
  readonly director: Bot;
  readonly staff: Bot;
  readonly coach: Bot;
};

/** What the stage drives: the wired command and people read over one store. */
export const wiring = (world: World) => {
  const store = createTabStore(world.database);
  const http = world.http;
  const direct = readOrganizationPeople({
    store,
    authorize,
    now: world.clock.now,
  });
  const people: typeof direct = http
    ? (actor, organizationId) => {
        const handle = world.made.get(`organization-handle:${organizationId}`);
        if (!handle)
          throw new StageFailed('organization handle was not recorded');
        return readTab(
          http,
          actor,
          'organization-people',
          { handle },
          organizationPeopleViewSchema,
        );
      }
    : direct;
  return {
    store,
    send: tabCommand(world, 'organization'),
    people,
  };
};
export type Wiring = ReturnType<typeof wiring>;

export const accepted = async (
  answer: Promise<LobbyCommandAnswer>,
  what: string,
): Promise<LobbyCommandReceipt> => {
  const settled = await answer;
  if (settled.kind !== 'accepted')
    throw new StageFailed(`${what}: ${JSON.stringify(settled)}`);
  return settled.receipt;
};

/** What the stage's first steps made: the league and Staff's first grant. */
export type League = {
  readonly organizationId: string;
  readonly handle: string;
  readonly give: Extract<OrganizationCommand, { type: 'give-grant' }>;
  readonly given: ReturnType<typeof envelope>;
  readonly granted: LobbyCommandReceipt;
};
