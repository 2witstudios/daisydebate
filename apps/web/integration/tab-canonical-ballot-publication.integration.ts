import { readEventBallot } from '../src/features/tab/reads/event-ballot';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { isAppError } from '@daisy/errors';
import {
  daisyWinnerBallot,
  storedBallotDefinition,
} from '@daisy/protocol/ballot-definition';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { setupCommand } from '../src/features/tab/operations/setup';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { preparePublication } from './tab-publication-setup.test-support';
import { publishDrawStage } from './tab-tournament-publication.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual canonical authoring, immutable revision, event pin and publication retain the original ballot', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
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
      ]),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(),
        made: new Map<string, string>(),
      };
      const ordinaryBody = {
        decision: daisyWinnerBallot.decision,
        points: daisyWinnerBallot.points,
        speakerRanks: daisyWinnerBallot.speakerRanks,
        written: daisyWinnerBallot.written,
      };
      const body = {
        ...ordinaryBody,
        points: {
          ...ordinaryBody.points!,
          per: 'seat' as const,
          scale: { min: 0.25, max: 0.56, step: 0.1 },
          default: 0.35,
          criteria: { kind: 'holistic' as const },
          weights: null,
        },
        speakerRanks: true,
        written: { reason: null, feedback: null },
      };
      let ballotId = '';
      await preparePublication(world, 'copy', async () => {
        const store = createTabStore(database);
        const send = setupCommand({
          store,
          authorize,
          now: world.clock.now,
          newId: createId,
        });
        const lobbyId = world.made.get('tournament-lobby')!;
        const [lobby] =
          await sql`select version from lobbies where id=${lobbyId}`;
        const envelope = {
          version: 1,
          commandId: createId(),
          expected: { lobby: Number(lobby!.version) },
          command: {
            type: 'define-ballot',
            lobbyId,
            ballotDefinition: {
              kind: 'new',
              name: 'Actual canonical publication',
            },
            settings: body,
          },
        };
        const created = await send(as(world.bots.Director!), envelope);
        if (created.kind !== 'accepted')
          throw new Error(
            `Canonical author refused: ${JSON.stringify(created)}`,
          );
        const [saved] =
          await sql`select d.id,v.definition from ballot_definitions d join ballot_definition_versions v on v.ballot_definition_id=d.id and v.version=1 where d.lobby_id=${lobbyId} and d.name='Actual canonical publication'`;
        ballotId = String(saved!.id);
        const replay = await send(as(world.bots.Director!), envelope);
        const snapshot = async () =>
          JSON.stringify(
            await sql`select d.id,d.current_version,v.version,v.definition from ballot_definitions d join ballot_definition_versions v on v.ballot_definition_id=d.id where d.id=${ballotId} order by v.version`,
          );
        const before = await snapshot();
        let refusedPrivateNote = false;
        try {
          await send(as(world.bots.Director!), {
            ...envelope,
            commandId: createId(),
            expected: { lobby: created.receipt.resultingVersion },
            command: {
              ...envelope.command,
              settings: {
                ...body,
                written: { ...body.written, privateNote: 'optional' },
              },
            },
          });
        } catch (error) {
          refusedPrivateNote = isAppError(error) && error.code === 'VALIDATION';
        }
        assert({
          given:
            'an actual accepted canonical define-ballot command, replay and forbidden private note',
          should:
            'persist only server-owned immutable identity, replay once and reject the unsupported collection without writes',
          actual: [
            saved!.definition,
            replay.kind === 'accepted' && replay.receipt.replayed,
            refusedPrivateNote,
            (await snapshot()) === before,
          ],
          expected: [
            storedBallotDefinition(ballotId, 1, body),
            true,
            true,
            true,
          ],
        });
        const revision = await send(as(world.bots.Director!), {
          version: 1,
          commandId: createId(),
          expected: { lobby: created.receipt.resultingVersion },
          command: {
            type: 'define-ballot',
            lobbyId,
            ballotDefinition: {
              kind: 'revision',
              ballotDefinitionId: ballotId,
            },
            settings: { ...body, points: null, speakerRanks: false },
          },
        });
        if (revision.kind !== 'accepted')
          throw new Error(
            `Canonical revision refused: ${JSON.stringify(revision)}`,
          );
        const pin = await send(as(world.bots.Director!), {
          version: 1,
          commandId: createId(),
          expected: { lobby: revision.receipt.resultingVersion },
          command: {
            type: 'update-event',
            lobbyId,
            eventId: world.made.get('event')!,
            name: 'Varsity',
            label: 'VAR',
            ballotDefinition: { id: ballotId, version: 1 },
          },
        });
        if (pin.kind !== 'accepted')
          throw new Error(`Canonical pin refused: ${JSON.stringify(pin)}`);
        const view = await readTournamentSetup({
          store,
          authorize,
          now: world.clock.now,
        })(as(world.bots.Director!), lobbyId);
        assert({
          given:
            'a later current revision and an explicitly pinned original version',
          should:
            'read the actual original event source without following the current pointer',
          actual: view?.events[0]?.ballotDefinition,
          expected: {
            ballotDefinitionId: ballotId,
            ballotDefinitionVersion: 1,
            name: 'Actual canonical publication',
          },
        });
      });
      const read = readEventBallot({
        store: createTabStore(database),
        authorize,
        now: world.clock.now,
      });
      const actual = await read(as(world.bots.Director!), {
        lobbyId: world.made.get('tournament-lobby')!,
        eventId: world.made.get('event')!,
      });
      assert({
        given:
          'the actual pinned source and current host authority after entries enroll',
        should:
          'serve exact canonical source and both immutable versions, disable repinning with entries and deny a non-host',
        actual: [
          actual?.definition,
          actual?.definitions
            .find((row) => row.id === ballotId)
            ?.versions.map((row) => [row.version, row.compatible]),
          actual?.capabilities.pin,
          await read(as(world.bots.Coach!), {
            lobbyId: world.made.get('tournament-lobby')!,
            eventId: world.made.get('event')!,
          }),
        ],
        expected: [
          {
            source: { kind: 'stored', id: ballotId, version: 1 },
            ballot: storedBallotDefinition(ballotId, 1, body),
          },
          [
            [1, true],
            [2, true],
          ],
          false,
          null,
        ],
      });
      await publishDrawStage(world);
      const rooms = await sql<
        { ballot_definition_id: string; ballot_definition_version: number }[]
      >`select r.ballot_definition_id,r.ballot_definition_version from rooms r join fixtures f on f.room_id=r.id where f.tab_round_id=${world.made.get('tab-round')!} order by r.id`;
      const [current] =
        await sql`select current_version from ballot_definitions where id=${ballotId}`;
      assert({
        given:
          'actual publication through accepted draw commands after canonical authoring and a later revision',
        should:
          'keep both real event Rooms pinned to the original authored source',
        actual: [
          rooms.map((room) => [
            room.ballot_definition_id,
            Number(room.ballot_definition_version),
          ]),
          Number(current!.current_version),
        ],
        expected: [
          [
            [ballotId, 1],
            [ballotId, 1],
          ],
          2,
        ],
      });
    },
  });
}, 60_000);
