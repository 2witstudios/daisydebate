import { createAppError } from '@daisy/errors';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { appendHistory } from './command-record';
import {
  loadFixtureCommandFacts,
  type FixtureCommandInput,
  type LoadedFixtureCommand,
} from './fixture-command-facts';
import {
  storedFixtureCommand,
  recordFixtureConflict,
  holdFixtureCommand,
} from './fixture-command-observation';
import type { FixtureOwnerEffects } from './fixture-owner-write';
import { applyFixtureWrites } from './fixture-writes';
import type { FixtureWrite } from './fixture-write';
import type { TabDatabase } from './tab-transaction';
import { inTransaction } from '../tx';
import { takeLock, transactionLocks } from '../locks';

/** Every panel, ordinary-owner effect and immutable result is in the fixture journal's one transaction. */
export const createFixtureCommandStore = (database: TabDatabase) => ({
  fixtureCommand: <Answer>(
    input: FixtureCommandInput,
    work: (session: {
      readonly load: () => Promise<LoadedFixtureCommand | null>;
      readonly stored: (id: string) => ReturnType<typeof storedFixtureCommand>;
      readonly recordConflict: (
        input: Pick<
          Parameters<typeof recordFixtureConflict>[1],
          'conflict' | 'now' | 'newId'
        >,
      ) => ReturnType<typeof recordFixtureConflict>;
      readonly hold: (
        input: Omit<
          Parameters<typeof holdFixtureCommand>[1],
          'lobbyId' | 'proposerUserId'
        >,
      ) => ReturnType<typeof holdFixtureCommand>;
      readonly apply: (
        writes: readonly FixtureWrite[],
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
        effects: FixtureOwnerEffects,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => {
      // Same command fence as ordinary Round writers, before account and aggregate locks.
      await takeLock(tx, transactionLocks.tabCommand(input.commandId));
      let loaded: LoadedFixtureCommand | null = null;
      return work({
        load: async () => {
          loaded = await loadFixtureCommandFacts(tx, input);
          return loaded;
        },
        stored: (id) => storedFixtureCommand(tx, input.lobbyId, id),
        recordConflict: async (observation) => {
          if (!loaded) throw createAppError('INVARIANT');
          return recordFixtureConflict(tx, {
            ...observation,
            lobbyId: input.lobbyId,
            fixtureId: loaded.context.fixture.id,
            userId: input.senderUserId,
          });
        },
        hold: (held) =>
          holdFixtureCommand(tx, {
            ...held,
            lobbyId: input.lobbyId,
            proposerUserId: input.senderUserId,
          }),
        apply: async (writes, history, receipt, effects) => {
          if (!loaded) throw createAppError('INVARIANT');
          await appendHistory(tx, history, receipt);
          await applyFixtureWrites(tx, loaded, input, writes, effects);
        },
      });
    }),
});
