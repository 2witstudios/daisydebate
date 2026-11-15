import {
  recordFixtureConflict,
  holdFixtureCommand,
  storedFixtureCommand,
} from './fixture-command-observation';
import { fixtureConnections } from './fixture-conflict';
import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { resultCompetitionRecordSchema } from '@daisy/protocol/lobby/result-record';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import type { ResultCommand } from '@daisy/protocol/lobby/result-command';
import { results, resultEntries, resultSpeakers } from '../schema/results';
import { fixtures, fixtureEntries } from '../schema/fixtures';
import { entries, entryMembers } from '../schema/entries';
import { tournamentJudges } from '../schema/tournament-judges';
import { actors } from '../schema/actors';
import { rooms } from '../schema/rooms';
import { ballotDefinitionVersions } from '../schema/ballot-definitions';
import { readRoomCompetitionProgress } from '../round-competition-source';
import { scopeTransaction } from '../tenant-scope';
import { lockTabCommandAccounts } from './command-accounts';
import { lockEventSettingContext } from './event-setting-context';
import { loadAuthorityContext } from './authority-context';
import { appendHistory, storedCommand } from './command-record';
import type { TabDatabase, TabTransaction } from './tab-transaction';

type Command = Extract<ResultCommand, { fixtureId: string }>;
export type ResultCommandInput = {
  readonly senderUserId: string;
  readonly lobbyId: string;
  readonly command: Command;
};
const load = async (tx: TabTransaction, input: ResultCommandInput) => {
  await scopeTransaction(tx, {
    subjectUserId: input.senderUserId,
    lobbyId: input.lobbyId,
  });
  await lockTabCommandAccounts(tx, [input.senderUserId]);
  const [address] = await tx
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.id, input.command.fixtureId),
        eq(fixtures.lobbyId, input.lobbyId),
      ),
    );
  if (!address) return null;
  const configuration = await lockEventSettingContext(tx, {
    lobbyId: address.lobbyId,
    eventId: address.eventId,
    subjectUserId: input.senderUserId,
  });
  if (!configuration || configuration.lobby.kind !== 'tournament') return null;
  const [fixture] = await tx
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.id, address.id),
        eq(fixtures.eventId, configuration.event.id),
        eq(fixtures.lobbyId, configuration.lobby.id),
      ),
    )
    .for('update');
  if (!fixture) return null;
  const authorization = await loadAuthorityContext(
    tx,
    configuration.scope,
    input.senderUserId,
  );
  const [owner] = configuration.lobby.ownerUserId
    ? await tx
        .select({ actorId: actors.id })
        .from(actors)
        .where(eq(actors.userId, configuration.lobby.ownerUserId))
    : [];
  const placed = await tx
    .select({
      entryId: fixtureEntries.entryId,
      position: fixtureEntries.position,
      side: fixtureEntries.side,
      schoolOrganizationId: entries.schoolOrganizationId,
    })
    .from(fixtureEntries)
    .innerJoin(
      entries,
      and(
        eq(entries.id, fixtureEntries.entryId),
        eq(entries.lobbyId, fixture.lobbyId),
      ),
    )
    .where(eq(fixtureEntries.fixtureId, fixture.id))
    .orderBy(fixtureEntries.position);
  const members = await tx
    .select({ entryId: entryMembers.entryId, actorId: entryMembers.actorId })
    .from(entryMembers)
    .innerJoin(fixtureEntries, eq(fixtureEntries.entryId, entryMembers.entryId))
    .where(eq(fixtureEntries.fixtureId, fixture.id));
  const judges = await tx
    .select({ id: tournamentJudges.id, actorId: tournamentJudges.actorId })
    .from(tournamentJudges)
    .where(eq(tournamentJudges.lobbyId, fixture.lobbyId));
  const retained = await tx
    .select()
    .from(results)
    .where(
      and(
        eq(results.fixtureId, fixture.id),
        eq(results.lobbyId, fixture.lobbyId),
      ),
    )
    .orderBy(results.recordedAt);
  const [room] = fixture.roomId
    ? await tx
        .select({
          rules: rooms.rulesSnapshot,
          ballotDefinitionId: rooms.ballotDefinitionId,
          ballotDefinitionVersion: rooms.ballotDefinitionVersion,
        })
        .from(rooms)
        .where(
          and(eq(rooms.id, fixture.roomId), eq(rooms.lobbyId, fixture.lobbyId)),
        )
        .for('share')
    : [];
  const progress =
    fixture.roomId && input.command.type !== 'correct-result'
      ? await readRoomCompetitionProgress(tx, fixture.roomId)
      : null;
  const pin = room ?? configuration.event;
  const [version] =
    pin.ballotDefinitionId !== null && pin.ballotDefinitionVersion !== null
      ? await tx
          .select()
          .from(ballotDefinitionVersions)
          .where(
            and(
              eq(
                ballotDefinitionVersions.ballotDefinitionId,
                pin.ballotDefinitionId,
              ),
              eq(ballotDefinitionVersions.version, pin.ballotDefinitionVersion),
            ),
          )
      : [];
  const connections = await fixtureConnections(tx, {
    fixtureId: fixture.id,
    roomId: fixture.roomId,
    userId: input.senderUserId,
  });
  return {
    connections,
    configuration,
    fixture,
    authorization,
    ownerActorId: owner?.actorId ?? null,
    entries: placed,
    members,
    judges,
    results: retained,
    progress,
    room,
    ballot: version ?? null,
  };
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
          for (const write of writes) {
            if (write.row.lobbyId !== loaded.fixture.lobbyId)
              throw createAppError('INVARIANT', 'Result tenant changed');
            switch (write.table) {
              case 'results':
                resultCompetitionRecordSchema.parse(
                  write.row.competitionRecord,
                );
                await tx.insert(results).values({
                  ...write.row,
                  recordedAt: new Date(write.row.recordedAt),
                });
                break;
              case 'result_entries':
                await tx.insert(resultEntries).values(write.row);
                break;
              case 'result_speakers':
                await tx.insert(resultSpeakers).values(write.row);
                break;
            }
          }
        },
      });
    }),
});
