import { createAppError } from '@daisy/errors';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { scopeTransaction } from '../tenant-scope';
import {
  appendHistory,
  storedCommand,
  type StoredTabCommand,
} from './command-record';
import {
  loadGuardianCommandFacts,
  type GuardianCommandInput,
  type LoadedGuardianCommand,
} from './guardian-command-facts';
import {
  applyGuardianCommandWrites,
  type GuardianCommandWrite,
} from './guardian-command-writes';
import type { TabDatabase } from './tab-transaction';
export type GuardianCommandSession = {
  readonly load: () => Promise<LoadedGuardianCommand | null>;
  readonly stored: (commandId: string) => Promise<StoredTabCommand | null>;
  readonly apply: (
    writes: readonly GuardianCommandWrite[],
    history: ActionHistoryEntry,
    receipt: LobbyCommandReceipt,
  ) => Promise<void>;
};
/** Ordinary scoped transactions only; no family write privilege is added or elevated. */
export const createGuardianCommandStore = (database: TabDatabase) => ({
  guardianCommand: <Answer>(
    input: GuardianCommandInput,
    work: (session: GuardianCommandSession) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      let loaded: LoadedGuardianCommand | null = null;
      return work({
        load: async () => {
          loaded = await loadGuardianCommandFacts(tx, input);
          return loaded;
        },
        stored: async (id) => {
          if (!loaded) return null;
          await scopeTransaction(tx, { subjectUserId: loaded.subjectUserId });
          return storedCommand(tx, id);
        },
        apply: async (writes, history, receipt) => {
          if (
            !loaded ||
            history.scope.kind !== 'person' ||
            history.scope.subjectUserId !== loaded.subjectUserId
          )
            throw createAppError(
              'INVARIANT',
              'Family journal subject differs from its command',
            );
          await scopeTransaction(tx, { subjectUserId: loaded.subjectUserId });
          await applyGuardianCommandWrites(tx, writes);
          await appendHistory(tx, history, receipt);
        },
      });
    }),
});
