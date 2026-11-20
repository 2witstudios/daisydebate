import { readFixtureWaiverRound } from './fixture-waiver-round';
import { createAppError } from '@daisy/errors';
import { readDatabaseTime } from '../database-clock';
import { readFixtureReadWaiver } from './fixture-read-waiver';
import { lockFixtureCommandContext } from './fixture-command-context';
import { fixtureConnections } from './fixture-conflict';
import {
  holdFixtureCommand,
  recordFixtureConflict,
  storedFixtureCommand,
} from './fixture-command-observation';
import type { TabDatabase } from './tab-transaction';
import { inTransaction, type Tx } from '../tx';
import { takeLock, transactionLocks } from '../locks';

const load = async (
  tx: Tx,
  input: {
    readonly senderUserId: string;
    readonly lobbyId: string;
    readonly fixtureId: string;
  },
) => {
  const context = await lockFixtureCommandContext(tx, {
    ...input,
    namedJudgeIds: [],
    roundSource: 'current-round',
  });
  if (!context) return null;
  const connections = await fixtureConnections(tx, {
    fixtureId: input.fixtureId,
    roomId: context.fixture.roomId,
    userId: input.senderUserId,
  });
  const waiverId = await readFixtureReadWaiver(tx, {
    ...input,
    userId: input.senderUserId,
  });
  return {
    ...context,
    connections,
    observedRound: await readFixtureWaiverRound(tx, context),
    waiverId,
    checkedAt: (await readDatabaseTime(tx)).toISOString(),
  };
};
export type LoadedConflictWaiverRequest = NonNullable<
  Awaited<ReturnType<typeof load>>
>;

/** A request can persist only an observation and a finite hold; only settlement can grant a waiver. */
export const createConflictWaiverRequestStore = (database: TabDatabase) => ({
  conflictWaiverRequest: <Answer>(
    input: {
      readonly senderUserId: string;
      readonly lobbyId: string;
      readonly fixtureId: string;
      readonly commandId: string;
    },
    work: (session: {
      readonly load: () => Promise<LoadedConflictWaiverRequest | null>;
      readonly stored: (id: string) => ReturnType<typeof storedFixtureCommand>;
      readonly recordConflict: (
        observation: Pick<
          Parameters<typeof recordFixtureConflict>[1],
          'conflict' | 'now' | 'newId'
        >,
      ) => ReturnType<typeof recordFixtureConflict>;
      readonly hold: (
        held: Omit<
          Parameters<typeof holdFixtureCommand>[1],
          'lobbyId' | 'proposerUserId'
        >,
        authorize: (now: string) => void,
      ) => ReturnType<typeof holdFixtureCommand>;
    }) => Promise<Answer>,
  ): Promise<Answer> =>
    inTransaction(database, async (tx) => {
      await takeLock(tx, transactionLocks.tabCommand(input.commandId));
      let loaded: LoadedConflictWaiverRequest | null = null;
      return work({
        load: async () => {
          loaded = await load(tx, input);
          return loaded;
        },
        stored: (id) => storedFixtureCommand(tx, input.lobbyId, id),
        recordConflict: (observation) => {
          if (!loaded) throw createAppError('INVARIANT');
          return recordFixtureConflict(tx, {
            ...observation,
            lobbyId: input.lobbyId,
            fixtureId: input.fixtureId,
            userId: input.senderUserId,
          });
        },
        hold: async (held, authorize) => {
          if (!loaded) throw createAppError('INVARIANT');
          authorize((await readDatabaseTime(tx)).toISOString());
          return holdFixtureCommand(tx, {
            ...held,
            lobbyId: input.lobbyId,
            proposerUserId: input.senderUserId,
          });
        },
      });
    }),
});
