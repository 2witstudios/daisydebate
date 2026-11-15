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
    return error instanceof CommandDenied;
  }
};

/** Rows as the runtime role sees them under one tenant's fence. */
export const underFence = <Row>(
  world: World,
  scope: { readonly organizationId?: string; readonly lobbyId?: string },
  read: (sql: SQL) => Promise<unknown>,
): Promise<Row[]> =>
  world.sql.savepoint(async (sql) => {
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
  return {
    store,
    send: organizationCommand({
      store,
      authorize,
      now: world.clock.now,
      newId: createId,
    }),
    people: readOrganizationPeople({ store, authorize, now: world.clock.now }),
  };
};
export type Wiring = ReturnType<typeof wiring>;

export const accepted = async (
  answer: Promise<OrganizationCommandAnswer>,
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
  readonly give: Extract<OrganizationCommand, { type: 'give-grant' }>;
  readonly given: ReturnType<typeof envelope>;
  readonly granted: LobbyCommandReceipt;
};
