import { lockTabCommandAccounts } from './command-accounts';
import { eq, sql } from 'drizzle-orm';
import type { SettingCommand } from '@daisy/protocol/lobby/setting-command';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { lobbies } from '../schema/lobbies';
import { events } from '../schema/events';
import { actors } from '../schema/actors';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import { loadOrganizationContext } from './organization-context';
import { loadSettingGraph, type SettingGraph } from './setting-graph';
import {
  appendHistory,
  storedCommand,
  type StoredTabCommand,
} from './command-record';
import type { TabDatabase, TabTransaction } from './tab-transaction';
import { applySettingWrites, type SettingWrite } from './setting-writes';

export type SettingCommandInput = {
  readonly senderUserId: string;
  readonly command: SettingCommand;
  readonly newId: string;
  readonly now: string;
  readonly newSettingId: () => string;
};

const target = (graph: SettingGraph, command: SettingCommand) => {
  const eventId =
    'eventId' in command
      ? command.eventId
      : 'scope' in command && command.scope.kind === 'event'
        ? command.scope.id
        : null;
  const event = graph.branches
    .flatMap((branch) => branch.events)
    .find((row) => row.id === eventId);
  const lobbyId =
    event?.lobbyId ??
    ('lobbyId' in command
      ? command.lobbyId
      : 'scope' in command && command.scope.kind === 'lobby'
        ? command.scope.id
        : null);
  const lobby = graph.lobbies.find((row) => row.id === lobbyId) ?? null;
  const templateId =
    'templateId' in command
      ? command.templateId
      : 'scope' in command && command.scope.kind === 'template'
        ? command.scope.id
        : null;
  const template = graph.templates.find((row) => row.id === templateId) ?? null;
  const organizationId =
    lobby !== null
      ? (lobby.ownerOrganizationId ?? undefined)
      : (template?.organizationId ??
        ('organizationId' in command
          ? command.organizationId
          : 'scope' in command && command.scope.kind === 'organization'
            ? command.scope.id
            : undefined));
  return { event: event ?? null, lobby, template, organizationId };
};
const load = async (tx: TabTransaction, input: SettingCommandInput) => {
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  await lockTabCommandAccounts(tx, [input.senderUserId]);
  // Every writer that can change a chain takes this fence before row locks.
  // It serializes checks of enforced values with follows and offers.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('tab-settings-chains', 0))`,
  );
  const graph = await loadSettingGraph(tx, {
    subjectUserId: input.senderUserId,
  });
  const named = target(graph, input.command);
  const scope: TenantScope = {
    subjectUserId: input.senderUserId,
    organizationId: graph.organizations.find(
      (row) => row.id === named.organizationId,
    )?.id,
    lobbyId: named.lobby?.id,
  };
  await scopeTransaction(tx, scope);
  const authorization = await loadOrganizationContext(
    tx,
    scope,
    input.senderUserId,
  );
  if (named.lobby)
    await tx
      .select({ id: lobbies.id })
      .from(lobbies)
      .where(eq(lobbies.id, named.lobby.id))
      .for('update');
  if (named.event)
    await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, named.event.id))
      .for('update');
  const [owner] = named.lobby?.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, named.lobby.ownerUserId))
    : [];
  // Root locks can have waited behind administration. The graph is read again
  // after acquiring them, so versions and names are never from before the wait.
  const current = await loadSettingGraph(tx, scope);
  return {
    graph: current,
    named: target(current, input.command),
    authorization,
    scope,
    ownerActorId: owner?.id ?? null,
  };
};
export type LoadedSettingCommand = Awaited<ReturnType<typeof load>>;
export type SettingCommandSession = {
  readonly load: () => Promise<LoadedSettingCommand>;
  readonly stored: (id: string) => Promise<StoredTabCommand | null>;
  readonly apply: (
    writes: readonly SettingWrite[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};
export const createSettingCommandStore = (database: TabDatabase) => ({
  settingCommand: <Answer>(
    input: SettingCommandInput,
    work: (session: SettingCommandSession) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) =>
      work({
        load: () => load(tx, input),
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt) => {
          await applySettingWrites(tx, writes, input.newSettingId);
          await appendHistory(tx, history, receipt);
        },
      }),
    ),
});
