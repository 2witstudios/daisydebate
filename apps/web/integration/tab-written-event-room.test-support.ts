import type { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { withRuntimeTestTransaction } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { preparePublication } from './tab-publication-setup.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { settingCommand } from '../src/features/tab/operations/settings';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { drawCompetition } from '../src/features/tab/operations/draw-competition';

/** Original published Daisy written ballot; no authored definition or copied pin is changed for this proof. */
export async function committedWrittenEventRoom(owner: SQL) {
  const cast = await createBots(owner, [
    'Director',
    'Staff',
    'Coach',
    'Judge A',
    'Judge B',
    'Judge C',
    'Debater 1',
    'Debater 2',
    'Debater 3',
    'Debater 4',
  ]);
  const state = {
    bots: Object.fromEntries(cast.map((person) => [person.name, person])),
    made: new Map<string, string>(),
    clock: scriptClock(Date.now() - 3_600_000),
  };
  return withRuntimeTestTransaction(owner, async (frame) => {
    const world = { ...frame, ...state };
    await preparePublication(world, 'follow', async () => {
      const lobbyId = state.made.get('tournament-lobby')!;
      const [lobby] =
        await frame.sql`select settings_version from lobbies where id=${lobbyId}`;
      const answer = await settingCommand({
        store: createTabStore(frame.database),
        authorize,
        now: state.clock.now,
        newId: createId,
      })(as(state.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { settings: Number(lobby!.settings_version) },
        command: {
          type: 'set-setting',
          scope: { kind: 'lobby', id: lobbyId },
          key: 'recording.capture',
          value: { value: 'off' },
          hold: 'default',
        },
      });
      if (answer.kind !== 'accepted')
        throw new Error('Recording-off command refused');
    });
    const lobbyId = state.made.get('tournament-lobby')!;
    const [slot] =
      await frame.sql`select version from time_slots where id=${state.made.get('time-slot')!}`;
    const [event] =
      await frame.sql`select entries_version from events where id=${state.made.get('event')!}`;
    const answer = await drawCommand({
      store: createTabStore(frame.database),
      authorize,
      now: state.clock.now,
      newId: createId,
      competition: drawCompetition,
    })(as(state.bots.Director!), lobbyId, {
      version: 1,
      commandId: createId(),
      expected: {
        draw: 1,
        entries: Number(event!.entries_version),
        timeSlot: Number(slot!.version),
      },
      command: {
        type: 'publish-draw',
        drawId: state.made.get('draw')!,
        overrides: [],
      },
    });
    if (answer.kind !== 'accepted')
      throw new Error(
        `Original written event publication refused: ${JSON.stringify(answer)}`,
      );
    const [room] =
      await frame.sql`select room_id from fixtures where tab_round_id=${state.made.get('tab-round')!} order by room_id limit 1`;
    if (!room) throw new Error('Original written event Room missing');
    return { ...state, roomId: String(room.room_id) };
  });
}
