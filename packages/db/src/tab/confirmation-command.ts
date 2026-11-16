import { recordFixtureConflict } from './fixture-command-observation';
import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { readDatabaseTime } from '../database-clock';
import { scopeTransaction } from '../tenant-scope';
import { pendingCommands, conflicts } from '../schema/conflicts';
import { appendHistory, storedCommand } from './command-record';
import {
  loadConfirmationCommandFacts,
  type ConfirmationCommandInput,
  type LoadedConfirmationCommand,
} from './confirmation-command-facts';
import { applyFixtureWrites } from './fixture-writes';
import { applyResultWrites } from './result-writes';
import type { FixtureOwnerEffects } from './fixture-owner-write';
import type { ConfirmationWrite } from './confirmation-write';
import type { TabDatabase } from './tab-transaction';

export type ConfirmationOwnerEffects = {
  readonly fixture: FixtureOwnerEffects | null;
  readonly authorize: (now: string) => void;
};
/** Settlement, original owner effects and both immutable receipts commit together or roll back together. */
export const createConfirmationCommandStore = (
  database: TabDatabase,
  readTime: typeof readDatabaseTime = readDatabaseTime,
) => ({
  confirmationCommand: <Answer>(
    input: ConfirmationCommandInput,
    work: (session: {
      readonly load: () => Promise<LoadedConfirmationCommand | null>;
      readonly stored: (id: string) => ReturnType<typeof storedCommand>;
      readonly recordConflict: (
        input: Pick<
          Parameters<typeof recordFixtureConflict>[1],
          'conflict' | 'now' | 'newId'
        >,
      ) => ReturnType<typeof recordFixtureConflict>;
      readonly apply: (
        writes: readonly ConfirmationWrite[],
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
        effects: ConfirmationOwnerEffects,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      let loaded: LoadedConfirmationCommand | null = null;
      return work({
        load: async () => {
          loaded = await loadConfirmationCommandFacts(tx, input, readTime);
          return loaded;
        },
        stored: (id) => storedCommand(tx, id),
        recordConflict: (observation) => {
          if (!loaded) throw createAppError('INVARIANT');
          return recordFixtureConflict(tx, {
            ...observation,
            lobbyId: input.lobbyId,
            fixtureId: loaded.context.fixture.id,
            userId: input.senderUserId,
          });
        },
        apply: async (writes, history, receipt, effects) => {
          if (!loaded) throw createAppError('INVARIANT');
          effects.authorize((await readTime(tx)).toISOString());
          await appendHistory(tx, history, receipt);
          for (const write of writes)
            if (write.table === 'action_history') {
              if (
                write.entry.commandId !== loaded.pending.commandId ||
                write.entry.actorUserId !== loaded.pending.proposerUserId ||
                write.entry.confirmedByUserId !== input.senderUserId ||
                write.entry.payloadDigest !== loaded.pending.payloadDigest
              )
                throw createAppError('INVARIANT');
              await appendHistory(tx, write.entry, {
                ...receipt,
                commandId: write.entry.commandId,
                aggregate: write.entry.aggregate,
                resultingVersion: write.entry.resultingVersion,
                replayed: false,
              });
            }
          for (const write of writes) {
            if (write.table === 'pending_commands') {
              if (
                write.commandId !== loaded.pending.commandId ||
                write.set.settledByUserId !== input.senderUserId
              )
                throw createAppError('INVARIANT');
              const changed = await tx
                .update(pendingCommands)
                .set({ ...write.set, settledAt: new Date(write.set.settledAt) })
                .where(
                  and(
                    eq(pendingCommands.commandId, write.commandId),
                    eq(pendingCommands.lobbyId, input.lobbyId),
                    eq(pendingCommands.status, 'pending'),
                  ),
                )
                .returning();
              if (changed.length !== 1) throw createAppError('CONFLICT');
            }
            if (write.table === 'conflicts') {
              if (
                write.row.lobbyId !== input.lobbyId ||
                write.row.fixtureId !== loaded.context.fixture.id ||
                write.row.userId !== loaded.pending.proposerUserId ||
                write.row.confirmedByUserId !== input.senderUserId
              )
                throw createAppError('INVARIANT');
              await tx.insert(conflicts).values({
                ...write.row,
                detectedAt: new Date(write.row.detectedAt),
              });
            }
          }
          const originalWrites = writes.filter(
            (write) =>
              write.table !== 'pending_commands' &&
              write.table !== 'action_history' &&
              write.table !== 'conflicts',
          );
          if (originalWrites.length && loaded.original.kind === 'fixture') {
            if (!loaded.original.facts || !effects.fixture)
              throw createAppError('INVARIANT');
            await scopeTransaction(tx, loaded.context.configuration.scope);
            if (originalWrites.length)
              await applyFixtureWrites(
                tx,
                loaded.original.facts,
                {
                  senderUserId: loaded.pending.proposerUserId,
                  lobbyId: input.lobbyId,
                  commandId: loaded.pending.commandId,
                  command: loaded.original.envelope.command,
                },
                originalWrites,
                effects.fixture,
              );
          } else {
            for (const write of originalWrites) {
              if (
                write.table !== 'results' &&
                write.table !== 'result_entries' &&
                write.table !== 'result_speakers'
              )
                throw createAppError('INVARIANT');
              await applyResultWrites(tx, input.lobbyId, [write]);
            }
          }
          effects.authorize((await readTime(tx)).toISOString());
        },
      });
    }),
});
