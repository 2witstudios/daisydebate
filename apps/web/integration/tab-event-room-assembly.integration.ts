import {
  activeRoomMembers,
  executeRoomCommand,
  resolveRoomConfiguration,
} from '@daisy/debate-engine';
import { requireTestServices } from '@daisy/config';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { assembleRoom } from '@daisy/db/room-assembly';
import { formatDefinitionSchema } from '@daisy/protocol/format';
import { roomConfigSchema } from '@daisy/protocol/room';
import { sideSeat } from '@daisy/protocol/seats';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('an event Room uses the shared assembly without a host person or fabricated Ready consent', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, ['Director', 'Staff', 'Coach', 'Debater 1', 'Debater 2']),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        clock: scriptClock(),
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      await leagueAdministrationStage(world);
      const lobbyId = world.made.get('tournament-lobby')!;
      const [format] =
        await sql`select r.definition, p.config from format_revisions r join format_presets p on p.format_id = r.format_id and p.format_version = r.version where r.format_id = 'freestyle' and r.version = 1 order by p.version desc limit 1`;
      const definition = formatDefinitionSchema.parse(format?.definition);
      const config = roomConfigSchema.parse({
        ...format?.config,
        resolutionDraw: { enabled: false },
      });
      const compiled = resolveRoomConfiguration(definition, config);
      if (!compiled.ok)
        throw new Error('assembly proof format did not compile');
      const roomId = createId();
      await database.transaction(async (tx) => {
        await sql`select set_config('daisy.lobby_scope', ${lobbyId}, true)`;
        await assembleRoom(tx, {
          room: {
            id: roomId,
            hostActorId: null,
            title: 'Event fixture',
            topic: 'Resolved: the event topic.',
            visibility: 'unlisted',
            formatId: 'freestyle',
            formatVersion: 1,
            presetVersion: null,
            basis: null,
            competitionType: 'casual',
            teamOneSide: 'affirmative',
            config,
            executionPlan: compiled.roomPlan,
            rules: compiled.rules,
          },
          lobby: { id: lobbyId, kind: 'tournament' },
          templateId: null,
          ballotDefinition: null,
          capture: { broadcast: null, recordingPolicy: 'off' },
          postRoundCall: false,
          now: world.clock.now(),
          caller: {
            userId: world.bots.Director!.userId,
            actorId: world.bots.Director!.actorId,
          },
          membersOf: (participants) =>
            activeRoomMembers({
              status: 'assembling',
              roundRef: null,
              participants,
            }),
          cast: {
            seats: [world.bots['Debater 1']!, world.bots['Debater 2']!].map(
              (person, index) => ({
                actorId: person.actorId,
                seat: sideSeat(index === 0 ? 'affirmative' : 'negative'),
                commandId: createId(),
                participantId: createId(),
              }),
            ),
            apply: (state, seat, target, now) =>
              executeRoomCommand(
                state,
                seat.actorId,
                {
                  type: 'claim-seat',
                  commandId: seat.commandId,
                  expectedVersion: state.version,
                  seat: seat.seat,
                },
                { available: true, readyActorIds: [] },
                {
                  now,
                  participantId: seat.participantId,
                  roundId: null,
                  formatId: '',
                  hostMaySeatCasualAiJudge: false,
                  hostHoldsCasualCapture: false,
                  target: target
                    ? {
                        ...target,
                        id: seat.participantId,
                        consentVersion: 0,
                        seat: seat.seat,
                        teamOpen: false,
                        positionOpen: false,
                      }
                    : null,
                  drawStart: null,
                  seatSeed: null,
                },
              ),
          },
        });
      });
      const [room] =
        await sql`select host_actor_id, lobby_id, lobby_kind, version from rooms where id = ${roomId}`;
      const seats =
        await sql`select p.actor_id, p.readiness_command_id, a.room_id from room_participants p join active_seats a on a.actor_id = p.actor_id where p.room_id = ${roomId} order by p.actor_id`;
      assert({
        given: 'the shared factory assembling accepted event entrants',
        should: 'retain the tournament scope without naming a host',
        actual: room && [
          room.host_actor_id,
          room.lobby_id,
          room.lobby_kind,
          room.version,
        ],
        expected: [null, lobbyId, 'tournament', 3],
      });
      assert({
        given: 'the seated humans reloaded from storage',
        should: 'hold active membership without inventing readiness',
        actual: seats.map(
          (row: {
            actor_id: string;
            readiness_command_id: string | null;
            room_id: string;
          }) => [row.actor_id, row.readiness_command_id, row.room_id],
        ),
        expected: [
          world.bots['Debater 1']!.actorId,
          world.bots['Debater 2']!.actorId,
        ]
          .sort()
          .map((id) => [id, null, roomId]),
      });
    },
  });
});
