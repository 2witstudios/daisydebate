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
export type DrawCommandSession = {
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
    database.transaction(async (tx) => {
      let loaded: LoadedDrawCommand | null = null;
      return work({
        load: async () => {
          loaded = await loadDrawCommandFacts(tx, input);
          return loaded;
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
          );
        },
      });
    }),
});
