import { sql } from 'drizzle-orm';
import { rowsOf } from '../raw-rows';
import type { LoadedDrawCommand } from '../tab/draw-command-facts';
import type { DrawRoomAssembly } from '../tab/draw-writes';
import type { DrawWrite } from '../tab/draw-write';
import {
  fixtureNotificationPeople,
  oweTournamentNotification,
  notifyTournamentRelease,
} from './tournament';
import type { Tx } from '../tx';

/** A draft owes nothing; published changes and real assembled Rooms tell only their affected cast. */
export async function notifyDrawChanges(
  tx: Tx,
  loaded: LoadedDrawCommand,
  writes: readonly DrawWrite[],
  assembly: DrawRoomAssembly,
  now: string,
  commandId: string,
) {
  for (const write of writes) {
    if (
      write.table === 'fixtures' &&
      write.op === 'update' &&
      ('publishedAt' in write.set || 'withdrawnAt' in write.set)
    ) {
      const people = await fixtureNotificationPeople(tx, write.where.id);
      const common = {
        fixtureId: write.where.id,
        lobbyId: loaded.configuration.lobby.id,
        commandId,
        at: now,
        newId: assembly.notificationIds,
        people,
      };
      await oweTournamentNotification(tx, {
        ...common,
        kind: 'tournament_draw_changed',
      });
      if ('publishedAt' in write.set) {
        await oweTournamentNotification(tx, {
          ...common,
          kind: 'judge_assigned',
          people: people.filter((person) => person.judgeId !== null),
        });
        const [room] = await rowsOf<{ status: string }>(
          tx,
          sql`select r.status from fixtures f join rooms r on r.id=f.room_id where f.id=${write.where.id}`,
        );
        if (room?.status === 'ready')
          await oweTournamentNotification(tx, {
            ...common,
            kind: 'tournament_room_ready',
          });
      }
    }
    if (write.table === 'releases')
      await notifyTournamentRelease(tx, write.row, assembly.notificationIds);
  }
}
