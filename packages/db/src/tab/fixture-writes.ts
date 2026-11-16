import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { fixtures, fixtureJudges } from '../schema/fixtures';
import { readDatabaseTime } from '../database-clock';
import {
  applyFixtureJudge,
  restartFixtureRoom,
  type FixtureOwnerEffects,
} from './fixture-owner-write';
import { applyResultWrites } from './result-writes';
import type {
  LoadedFixtureCommand,
  FixtureCommandInput,
} from './fixture-command-facts';
import type { FixtureWrite } from './fixture-write';
import type { TabTransaction } from './tab-transaction';

/** Both direct and confirmed officiating use the same fenced owner writer. */
export async function applyFixtureWrites(
  tx: TabTransaction,
  loaded: LoadedFixtureCommand,
  input: FixtureCommandInput,
  writes: readonly FixtureWrite[],
  effects: FixtureOwnerEffects,
) {
  const { fixture } = loaded.context;
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
          if (write.fixtureId !== fixture.id) throw createAppError('INVARIANT');
          const where = and(
            eq(fixtureJudges.fixtureId, fixture.id),
            eq(fixtureJudges.lobbyId, input.lobbyId),
            eq(fixtureJudges.tournamentJudgeId, write.tournamentJudgeId),
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
}
