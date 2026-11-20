import { and, eq, or } from 'drizzle-orm';
import type { TournamentSetupCommand } from '@daisy/protocol/lobby/lobby-setup-command';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { daisyOrganizationId } from '../daisy-reference';
import { actors } from '../schema/actors';
import { lobbies } from '../schema/lobbies';
import { ballotDefinitions } from '../schema/ballot-definitions';
import { stages, tabRounds, timeSlots } from '../schema/events';
import { entryMembers, entries } from '../schema/entries';
import { draws } from '../schema/draws';
import { resolutionPools, poolResolutions } from '../schema/resolution-pools';
import { scopeTransaction } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { loadAuthorityContext } from './authority-context';
import { loadSettingGraph } from './setting-graph';
import {
  appendHistory,
  storedCommand,
  type StoredTabCommand,
} from './command-record';
import { applySetupWrites } from './setup-writes';
import type { SetupWrite } from './setup-write';
import type { TabDatabase } from './tab-transaction';
import { inTransaction, type Tx } from '../tx';
import { takeLock, transactionLocks } from '../locks';

export type SetupCommandInput = {
  readonly senderUserId: string;
  readonly command: TournamentSetupCommand;
  readonly newIds: { readonly primary: string; readonly secondary: string };
  readonly now: string;
};
const load = async (tx: Tx, input: SetupCommandInput) => {
  await scopeTransaction(tx, { subjectUserId: input.senderUserId });
  await lockTabCommandAccounts(tx, [input.senderUserId]);
  await takeLock(tx, transactionLocks.tabSettingsChains());
  const [found] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, input.command.lobbyId));
  const scope = {
    subjectUserId: input.senderUserId,
    organizationId: found?.ownerOrganizationId ?? undefined,
    lobbyId: found?.id,
  };
  await scopeTransaction(tx, scope);
  const authorization = await loadAuthorityContext(
    tx,
    scope,
    input.senderUserId,
  );
  const [lobby] = found
    ? await tx
        .select()
        .from(lobbies)
        .where(eq(lobbies.id, found.id))
        .for('update')
    : [];
  const [owner] = lobby?.ownerUserId
    ? await tx
        .select({ id: actors.id })
        .from(actors)
        .where(eq(actors.userId, lobby.ownerUserId))
    : [];
  const lobbyId = lobby?.id ?? input.command.lobbyId;
  return {
    lobby: lobby ?? null,
    authorization,
    ownerActorId: owner?.id ?? null,
    graph: await loadSettingGraph(tx, scope, [lobbyId]),
    stages: await tx.select().from(stages).where(eq(stages.lobbyId, lobbyId)),
    rounds: await tx
      .select()
      .from(tabRounds)
      .where(eq(tabRounds.lobbyId, lobbyId)),
    slots: await tx
      .select()
      .from(timeSlots)
      .where(eq(timeSlots.lobbyId, lobbyId)),
    draws: await tx
      .select({ tabRoundId: draws.tabRoundId, status: draws.status })
      .from(draws)
      .where(eq(draws.lobbyId, lobbyId)),
    entrants: await tx
      .select({ eventId: entries.eventId, userId: actors.userId })
      .from(entryMembers)
      .innerJoin(entries, eq(entries.id, entryMembers.entryId))
      .innerJoin(actors, eq(actors.id, entryMembers.actorId))
      .where(and(eq(entries.lobbyId, lobbyId), eq(entries.status, 'accepted'))),
    ballots: await tx
      .select()
      .from(ballotDefinitions)
      .where(
        or(
          eq(ballotDefinitions.lobbyId, lobbyId),
          eq(ballotDefinitions.organizationId, daisyOrganizationId),
          ...(scope.organizationId
            ? [eq(ballotDefinitions.organizationId, scope.organizationId)]
            : []),
        ),
      ),
    pools: await tx
      .select()
      .from(resolutionPools)
      .where(
        or(
          eq(resolutionPools.lobbyId, lobbyId),
          ...(scope.organizationId
            ? [eq(resolutionPools.organizationId, scope.organizationId)]
            : []),
        ),
      ),
    resolutions: await tx
      .select()
      .from(poolResolutions)
      .where(
        or(
          eq(poolResolutions.lobbyId, lobbyId),
          ...(scope.organizationId
            ? [eq(poolResolutions.organizationId, scope.organizationId)]
            : []),
        ),
      ),
  };
};
export type LoadedSetupCommand = Awaited<ReturnType<typeof load>>;
export type SetupCommandSession = {
  readonly load: () => Promise<LoadedSetupCommand>;
  readonly stored: (id: string) => Promise<StoredTabCommand | null>;
  readonly apply: (
    writes: readonly SetupWrite[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};
export const createSetupCommandStore = (database: TabDatabase) => ({
  setupCommand: <Answer>(
    input: SetupCommandInput,
    work: (session: SetupCommandSession) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) =>
      work({
        load: () => load(tx, input),
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt) => {
          await applySetupWrites(tx, writes);
          await appendHistory(tx, history, receipt);
        },
      }),
    ),
});
