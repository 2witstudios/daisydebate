import { readFixtureCompetitionFacts } from './fixture-competition-facts';
import { lockFixtureCommandContext } from './fixture-command-context';
import {
  recordFixtureConflict,
  holdFixtureCommand,
  storedFixtureCommand,
} from './fixture-command-observation';
import { createAppError } from '@daisy/errors';
import { applyResultWrites } from './result-writes';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import type { ResultCommand } from '@daisy/protocol/lobby/result-command';
import { results, resultEntries, resultSpeakers } from '../schema/results';
import { appendHistory, storedCommand } from './command-record';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Command = Extract<ResultCommand, { fixtureId: string }>;
export type ResultCommandInput = {
  readonly senderUserId: string;
  readonly lobbyId: string;
  readonly command: Command;
};
const load = async (tx: TabTransaction, input: ResultCommandInput) => {
  const context = await lockFixtureCommandContext(tx, {
    senderUserId: input.senderUserId,
    lobbyId: input.lobbyId,
    fixtureId: input.command.fixtureId,
    namedJudgeIds: [],
    roundSource:
      input.command.type === 'correct-result'
        ? 'retained-result'
        : 'current-round',
  });
  if (!context) return null;
  return readFixtureCompetitionFacts(tx, context, input.senderUserId);
};
export type LoadedResultCommand = NonNullable<Awaited<ReturnType<typeof load>>>;
export type ResultWrite =
  | {
      readonly table: 'results';
      readonly op: 'insert';
      readonly row: Omit<typeof results.$inferInsert, 'recordedAt'> & {
        readonly recordedAt: string;
      };
    }
  | {
      readonly table: 'result_entries';
      readonly op: 'insert';
      readonly row: typeof resultEntries.$inferInsert;
    }
  | {
      readonly table: 'result_speakers';
      readonly op: 'insert';
      readonly row: typeof resultSpeakers.$inferInsert;
    };
export const createResultCommandStore = (database: TabDatabase) => ({
  resultCommand: <Answer>(
    input: ResultCommandInput,
    work: (session: {
      readonly load: () => Promise<LoadedResultCommand | null>;
      readonly stored: (id: string) => ReturnType<typeof storedCommand>;
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
        writes: readonly ResultWrite[],
        history: ActionHistoryEntry,
        receipt: LobbyCommandReceipt,
      ) => Promise<void>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    database.transaction(async (tx) => {
      let loaded: LoadedResultCommand | null = null;
      return work({
        load: async () => {
          loaded = await load(tx, input);
          return loaded;
        },
        stored: (id) => storedFixtureCommand(tx, input.lobbyId, id),
        recordConflict: async (observation) => {
          if (!loaded) throw createAppError('INVARIANT');
          return recordFixtureConflict(tx, {
            ...observation,
            lobbyId: loaded.fixture.lobbyId,
            fixtureId: loaded.fixture.id,
            userId: input.senderUserId,
          });
        },
        hold: async (held) => {
          if (!loaded) throw createAppError('INVARIANT');
          return holdFixtureCommand(tx, {
            ...held,
            lobbyId: loaded.fixture.lobbyId,
            proposerUserId: input.senderUserId,
          });
        },
        apply: async (writes, history, receipt) => {
          if (!loaded)
            throw createAppError('INVARIANT', 'Result facts not loaded');
          await appendHistory(tx, history, receipt);
          await applyResultWrites(tx, loaded.fixture.lobbyId, writes);
        },
      });
    }),
});
