import { and, eq, sql } from 'drizzle-orm';
import { readDatabaseTime } from '../database-clock';
import { createAppError } from '@daisy/errors';
import type {
  ActionHistoryEntry,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { fixtures, fixtureJudges } from '../schema/fixtures';
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
import {
  applyFixtureJudge,
  restartFixtureRoom,
  type FixtureOwnerEffects,
} from './fixture-owner-write';
import { applyResultWrites } from './result-writes';
import type { FixtureWrite } from './fixture-write';
import type { TabDatabase } from './tab-transaction';

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
    database.transaction(async (tx) => {
      // Same command fence as ordinary Round writers, before account and aggregate locks.
      await tx.execute(
        sql`select pg_advisory_xact_lock(59002, hashtext(${input.commandId}))`,
      );
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
          const { fixture } = loaded.context;
          await appendHistory(tx, history, receipt);
          await applyFixtureJudge(tx, loaded, input, effects);
          for (const write of writes) {
            switch (write.table) {
              case 'fixture_judges':
                if (write.op === 'insert') {
                  if (
                    write.row.fixtureId !== fixture.id ||
                    write.row.lobbyId !== input.lobbyId
                  )
                    throw createAppError('INVARIANT');
                  await tx.insert(fixtureJudges).values(write.row);
                } else {
                  if (write.fixtureId !== fixture.id)
                    throw createAppError('INVARIANT');
                  const where = and(
                    eq(fixtureJudges.fixtureId, fixture.id),
                    eq(fixtureJudges.lobbyId, input.lobbyId),
                    eq(
                      fixtureJudges.tournamentJudgeId,
                      write.tournamentJudgeId,
                    ),
                  );
                  const changed =
                    write.op === 'delete'
                      ? await tx.delete(fixtureJudges).where(where).returning()
                      : await tx
                          .update(fixtureJudges)
                          .set(write.set)
                          .where(where)
                          .returning();
                  if (changed.length !== 1) throw createAppError('INVARIANT');
                }
                break;
              case 'fixtures': {
                if (write.id !== fixture.id) throw createAppError('INVARIANT');
                const changed = await tx
                  .update(fixtures)
                  .set(write.set)
                  .where(
                    and(
                      eq(fixtures.id, fixture.id),
                      eq(fixtures.lobbyId, input.lobbyId),
                      eq(fixtures.version, fixture.version),
                    ),
                  )
                  .returning();
                if (changed.length !== 1) throw createAppError('CONFLICT');
                break;
              }
              case 'round_source_voids':
                if (
                  write.row.roundId !== loaded.context.round?.id ||
                  input.command.type !== 'restart-fixture'
                )
                  throw createAppError('INVARIANT');
                // The following Room effect invokes the ordinary source owner atomically.
                break;
              case 'rooms':
                if (
                  write.likeRoomId !== fixture.roomId ||
                  input.command.type !== 'restart-fixture'
                )
                  throw createAppError('INVARIANT');
                await restartFixtureRoom(tx, loaded, effects, write.id);
                break;
              case 'results':
              case 'result_entries':
              case 'result_speakers':
                await applyResultWrites(tx, input.lobbyId, [write]);
                break;
            }
          }
          effects.authorize((await readDatabaseTime(tx)).toISOString());
        },
      });
    }),
});
