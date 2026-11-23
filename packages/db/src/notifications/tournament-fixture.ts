import { tournamentJudgeStatuses } from '@daisy/protocol/lobby';
import { listedWord } from '../lifecycle-sql';
import { roomStatuses } from '@daisy/protocol/room-contract';
import { sql } from 'drizzle-orm';
import { query } from '../raw-rows';
import type {
  LoadedFixtureCommand,
  FixtureCommandInput,
} from '../tab/fixture-command-facts';
import type { FixtureWrite } from '../tab/fixture-write';
import {
  fixtureNotificationPeople,
  oweTournamentNotification,
} from './tournament';
import type { Tx } from '../tx';
import { z } from 'zod';

/** Shared by direct and confirmed officiating, using the original command's identity. */
export async function notifyFixtureChanges(
  tx: Tx,
  loaded: LoadedFixtureCommand,
  input: FixtureCommandInput,
  writes: readonly FixtureWrite[],
  newId: () => string,
) {
  const { fixture } = loaded.context;
  const common = {
    fixtureId: fixture.id,
    lobbyId: input.lobbyId,
    commandId: input.commandId,
    at: loaded.checkedAt,
    newId,
  };
  // A draft draw is not yet anyone's news: publishing it tells its people.
  if (fixture.status !== 'published') return;
  for (const write of writes) {
    if (write.table !== 'fixture_judges' || write.op === 'update') continue;
    const judgeId =
      write.op === 'insert'
        ? write.row.tournamentJudgeId
        : write.tournamentJudgeId;
    const people = await query(
      tx,
      z.object({ userId: z.string(), actorId: z.string() }),
      sql`select a.user_id as "userId",a.id as "actorId"
      from tournament_judges j join actors a on a.id=j.actor_id join users u on u.id=a.user_id and u.deleted_at is null
      where j.id=${judgeId} and j.lobby_id=${input.lobbyId} and j.status=${listedWord(tournamentJudgeStatuses, 'accepted')}`,
    );
    await oweTournamentNotification(tx, {
      ...common,
      people,
      kind:
        write.op === 'insert'
          ? 'judge_assigned'
          : input.command.type === 'replace-judge'
            ? 'judge_replaced'
            : 'judge_unassigned',
    });
  }
  if (
    writes.some(
      (write) => write.table === 'fixture_judges' || write.table === 'rooms',
    )
  ) {
    const people = await fixtureNotificationPeople(tx, fixture.id);
    await oweTournamentNotification(tx, {
      ...common,
      people,
      kind: 'tournament_draw_changed',
    });
    const [room] = await query(
      tx,
      z.object({ status: z.enum(roomStatuses) }),
      sql`select r.status from fixtures f join rooms r on r.id=f.room_id where f.id=${fixture.id}`,
    );
    if (room?.status === 'ready') {
      const newJudges = writes.flatMap((write) =>
        write.table === 'fixture_judges' && write.op === 'insert'
          ? [write.row.tournamentJudgeId]
          : [],
      );
      const newlyReady =
        loaded.roomState?.status !== 'ready' ||
        writes.some((write) => write.table === 'rooms');
      await oweTournamentNotification(tx, {
        ...common,
        people: newlyReady
          ? people
          : people.filter(
              (person) =>
                person.judgeId !== null && newJudges.includes(person.judgeId),
            ),
        kind: 'tournament_room_ready',
      });
    }
  }
}
