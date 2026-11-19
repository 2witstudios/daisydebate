import { loadLeagueRatingInputs } from './league-rating-inputs';
import { scopeTransaction } from '../tenant-scope';
import { loadLobbyAuthority } from './lobby-authority';
import { createAppError } from '@daisy/errors';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import type { TabDatabase } from './tab-transaction';
import {
  loadDrawCommandFacts,
  type DrawCommandInput,
  type LoadedDrawCommand,
} from './draw-command-facts';
import {
  appendHistory,
  storedCommand,
  type StoredTabCommand,
} from './command-record';
import { applyDrawWrites, type DrawRoomAssembly } from './draw-writes';
import type { DrawWrite } from './draw-write';
import { inTransaction } from '../tx';
export type DrawCommandSession = {
  readonly lobbyAuthority: () => ReturnType<typeof loadLobbyAuthority>;
  readonly ratingInputs: (
    ladderIds: readonly string[],
  ) => Promise<
    readonly NonNullable<Awaited<ReturnType<typeof loadLeagueRatingInputs>>>[]
  >;
  readonly load: () => Promise<LoadedDrawCommand | null>;
  readonly stored: (id: string) => Promise<StoredTabCommand | null>;
  readonly apply: (
    writes: readonly DrawWrite[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
    assembly: DrawRoomAssembly,
  ) => Promise<void>;
};
export const createDrawCommandStore = (database: TabDatabase) => ({
  drawCommand: <Answer>(
    input: DrawCommandInput,
    work: (session: DrawCommandSession) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => {
      let loaded: LoadedDrawCommand | null = null;
      return work({
        lobbyAuthority: () =>
          loadLobbyAuthority(tx, {
            viewerUserId: input.senderUserId,
            lobbyId: input.lobbyId,
          }),
        load: async () => {
          loaded = await loadDrawCommandFacts(tx, input);
          return loaded;
        },
        ratingInputs: async (ladderIds) => {
          const inputs = [];
          for (const ladderId of [...new Set(ladderIds)].sort()) {
            const found = await loadLeagueRatingInputs(tx, {
              viewerUserId: input.senderUserId,
              ladderId,
              allowedOrganizationIds:
                loaded?.ratingConfigurations.flatMap((configuration) =>
                  [
                    configuration.template?.organizationId,
                    configuration.lobby.ownerOrganizationId,
                  ].filter((id): id is string => typeof id === 'string'),
                ) ?? [],
            });
            if (
              found &&
              loaded?.ratingConfigurations.some(
                (configuration) =>
                  configuration.template?.organizationId ===
                    found.ladder.organizationId ||
                  configuration.lobby.ownerOrganizationId ===
                    found.ladder.organizationId,
              )
            )
              inputs.push(found);
          }
          if (loaded) await scopeTransaction(tx, loaded.configuration.scope);
          return inputs;
        },
        stored: (id) => storedCommand(tx, id),
        apply: async (writes, history, receipt, assembly) => {
          if (!loaded)
            throw createAppError(
              'INVARIANT',
              'Draw command facts were not loaded',
            );
          // Releases reference this command; every dependent write still rolls back with its receipt.
          await appendHistory(tx, history, receipt);
          await applyDrawWrites(
            tx,
            loaded,
            writes,
            assembly,
            history.appliedAt,
            history.commandId,
          );
        },
      });
    }),
});
