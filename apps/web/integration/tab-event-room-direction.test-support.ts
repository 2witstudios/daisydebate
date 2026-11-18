import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { seedPaidHosting } from './hosting-purchase.test-support';
import type { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { withRuntimeTestTransaction } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { settingCommand } from '../src/features/tab/operations/settings';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { preparePublication } from './tab-publication-setup.test-support';
import { copyForeignBallot } from './tab-copied-ballot.test-support';
import { firstDrawCompetition } from './tab-tournament-draw-draft.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

/** Real committed publication, visible to the ordinary Room runtime's separate connections. */
export const committedEventRoom = async (
  owner: SQL,
  mode: 'copy' | 'detach',
  options: {
    readonly noPrep?: boolean;
    readonly recording?: 'off' | 'on';
    readonly tournamentOwner?: 'personal' | 'organization';
    /**
     * What lets a recorded tournament record (ADR 0149): a paid hosting
     * purchase, or a hosting grant naming it (for suites about grant funding).
     */
    readonly hosting?: 'paid' | 'granted';
  } = {},
) => {
  const bots = await createBots(owner, [
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
    bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
    clock: scriptClock(Date.now() - 60 * 60_000),
    made: new Map<string, string>(),
  };
  const published = await withRuntimeTestTransaction(owner, async (frame) => {
    const world = { ...frame, ...state };
    const copied: {
      value: Awaited<ReturnType<typeof copyForeignBallot>> | null;
    } = { value: null };
    await preparePublication(
      world,
      'follow',
      async () => {
        copied.value = await copyForeignBallot(world, mode);
        const lobbyId = state.made.get('tournament-lobby')!;
        if (options.recording === 'on' && options.hosting === 'granted')
          await seedHostingGrant(frame.sql, state.bots.Director!.userId, {
            tournamentIds: [lobbyId],
            replaceCurrent: true,
          });
        else if (options.recording === 'on')
          await seedPaidHosting(
            frame.sql,
            lobbyId,
            state.bots.Director!.userId,
          );
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
            value: { value: options.recording ?? 'off' },
            hold: 'default',
          },
        });
        if (answer.kind !== 'accepted')
          throw new Error(
            `Recording policy refused: ${JSON.stringify(answer)}`,
          );
        if (options.noPrep) {
          const eventId = state.made.get('event')!;
          const [event] =
            await frame.sql`select version,settings_version,entries_version from events where id=${eventId}`;
          const timing = await settingCommand({
            store: createTabStore(frame.database),
            authorize,
            now: state.clock.now,
            newId: createId,
          })(as(state.bots.Director!), {
            version: 1,
            commandId: createId(),
            expected: {
              settings: Number(event!.settings_version),
              event: Number(event!.version),
              entries: Number(event!.entries_version),
            },
            command: {
              type: 'set-setting',
              scope: { kind: 'event', id: eventId },
              key: 'room.timing',
              value: {
                preRoundPrepMs: 0,
                inRoundPrepMsPerSide: 0,
                countdownMs: 0,
              },
              hold: 'default',
            },
          });
          if (timing.kind !== 'accepted')
            throw new Error(
              `Fixture timing refused: ${JSON.stringify(timing)}`,
            );
        }
      },
      options,
    );
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
      competition: firstDrawCompetition,
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
        `Committed publication refused: ${JSON.stringify(answer)}`,
      );
    const [room] =
      await frame.sql`select r.id,r.capture from rooms r join fixtures f on f.room_id=r.id where f.tab_round_id=${state.made.get('tab-round')!} order by r.id limit 1`;
    if (!room || !copied.value)
      throw new Error('Published copied source Room is missing');
    return {
      roomId: String(room.id),
      copied: copied.value,
      capture: room.capture,
    };
  });
  return { ...state, ...published };
};
