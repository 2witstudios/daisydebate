import { proveDrawArea } from './tab-host-draw-area.test-support';
import { readHostRound } from '../src/features/tab/reads/host-round';
import { readHostDrawOverview } from '../src/features/tab/reads/host-draw-overview';
import { readHostResults } from '../src/features/tab/reads/host-results';
import {
  createHostResultsRoute,
  hostResultsPath,
} from '../src/features/tab/host-results-route';
import {
  createHostBallotsRoute,
  hostBallotsPath,
} from '../src/features/tab/host-ballots-route';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { noopErrorReporter } from '@daisy/observability';
import { readHostBallots } from '../src/features/tab/reads/host-ballots';
import { withActualCopiedBallot } from './tab-actual-ballot.test-support';
import { roundBallotReader } from '../src/features/round-ballots/reader';
import { roundViewReader } from '../src/features/round-runtime/reads';
import { isAppError } from '@daisy/errors';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import {
  committingRuntimeTestDatabase,
  scratchDatabase,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { createBots } from './tab-tournament.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { readHostNavigation } from '../src/features/tab/reads/host-navigation';
import { hostNavigationRail } from '../src/features/tab/host-navigation';
import { readHostStandings } from '../src/features/tab/reads/host-standings';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { readTournamentEventSettings } from '../src/features/tab/reads/tournament-event-settings';
import { readEventBallot } from '../src/features/tab/reads/event-ballot';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual narrow lobby roles open only their host areas and rails, and current revocation removes the shell', async () => {
  const scratch = scratchDatabase(databaseUrl, 'hostareas');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 2 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', {
      noPrep: true,
      tournamentOwner: 'organization',
    });
    const lobbyId = world.made.get('tournament-lobby')!,
      eventId = world.made.get('event')!,
      organizationId = world.made.get('league')!;
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const dependencies = {
      store,
      authorize,
      now: () => new Date().toISOString(),
      newId: createId,
    };
    const command = organizationCommand(dependencies);
    const navigation = readHostNavigation(dependencies);
    const standings = readHostStandings(dependencies);
    const hostResults = readHostResults(dependencies);
    const setup = readTournamentSetup(dependencies);
    const settings = readTournamentEventSettings(dependencies);
    const ballot = readEventBallot(dependencies);
    const hostBallots = readHostBallots(dependencies);
    const people = await createBots(owner, [
      'Ballot reviewer only',
      'Results staff only',
    ]);
    await withActualCopiedBallot(
      { owner, databaseUrl: scratch.url, world },
      async ({ runtime, roundId, ballotId }) => {
        const readBallot = roundBallotReader(runtime.store);
        const readVideo = roundViewReader(runtime.store);
        const hidden = async (read: () => Promise<unknown>) => {
          try {
            await read();
            return false;
          } catch (error) {
            if (isAppError(error) && error.code === 'NOT_FOUND') return true;
            throw error;
          }
        };
        for (const [index, permission] of [
          'tournament.ballots.read_unreleased',
          'tournament.results.enter',
        ].entries()) {
          const person = people[index]!,
            roleId = createId();
          // Custom-role editor is a separate feature. These real permission rows
          // are fixture inputs; the actual guarded grant command grants that role.
          await owner`insert into roles(id,organization_id,name,rank,preset) values(${roleId},${organizationId},${person.name},${50 + index},false)`;
          await owner`insert into role_permissions(role_id,organization_id,permission) values(${roleId},${organizationId},${permission})`;
          const [before] =
            await owner`select version from lobbies where id=${lobbyId}`;
          const granted = await command(as(world.bots.Director!), {
            version: 1,
            commandId: createId(),
            expected: { lobby: Number(before!.version) },
            command: {
              type: 'give-grant',
              scope: { kind: 'lobby', lobbyId },
              userId: person.userId,
              roleId,
              expiresAt: null,
            },
          });
          if (granted.kind !== 'accepted')
            throw new Error(
              `Actual narrow grant refused: ${JSON.stringify(granted)}`,
            );
          const nav = await navigation(as(person), {
            kind: 'lobby',
            id: lobbyId,
          });
          const expectedArea =
            index === 0 ? 'lobby.host.ballots.read' : 'lobby.host.results.read';
          const resolved = await settings(as(person), {
            lobbyId,
            eventId,
            area: 'results',
          });
          assert({
            given: `the real ${permission} role with no other permission`,
            should:
              'open exactly its evaluated area, conceal setup and keep results metadata within the results area',
            actual: [
              nav?.areas,
              nav && hostNavigationRail(nav).items.map((item) => item.id),
              await readHostRound(dependencies)(as(person), {
                lobbyId,
                eventId,
                tabRoundId: world.made.get('tab-round')!,
              }),
              await readHostDrawOverview(dependencies)(as(person), { lobbyId }),
              await setup(as(person), lobbyId),
              await settings(as(person), { lobbyId, eventId }),
              await ballot(as(person), { lobbyId, eventId }),
              (await standings(as(person), { lobbyId, eventId }))?.visibility ??
                null,
              resolved?.settings.map((row) => row.key) ?? null,
            ],
            expected: [
              [expectedArea],
              index === 0 ? ['ballots'] : ['break', 'results'],
              null,
              null,
              null,
              null,
              null,
              index === 0 ? null : 'official',
              index === 0
                ? null
                : ['standings.tiebreaks', 'standings.rating_ladder'],
            ],
          });
          const resultsRoute = (released: boolean) =>
            createHostResultsRoute({
              boundary: {
                logger: silentLogger,
                reporter: noopErrorReporter,
                origin: () => origin,
                identify: async () => ({
                  ...member,
                  principal: { ...as(person), actorId: person.actorId },
                }),
              },
              released: async () => released,
              read: hostResults,
            });
          const resultsRequest = () =>
            new Request(`${origin}${hostResultsPath(lobbyId, eventId)}`, {
              headers: { origin },
            });
          const responseResults = await resultsRoute(true)(resultsRequest());
          const resultBody = await responseResults.json();
          assert({
            given: `the actual ${permission} role at the Results HTTP boundary`,
            should:
              'require its own derived area and the closed release without exposing private screening words',
            actual: [
              responseResults.status,
              (await resultsRoute(false)(resultsRequest())).status,
              responseResults.status === 200
                ? responseResults.headers.get('cache-control')
                : null,
              responseResults.status === 200
                ? resultBody.results.ballotAccess
                : null,
              responseResults.status === 200
                ? 'screeningHolds' in resultBody.results
                : false,
            ],
            expected: [
              index === 0 ? 404 : 200,
              404,
              index === 0 ? null : 'no-store',
              index === 0 ? null : 'released',
              false,
            ],
          });
          const listed = await hostBallots(as(person), { lobbyId, eventId });
          const route = (released = true) =>
            createHostBallotsRoute({
              boundary: {
                logger: silentLogger,
                reporter: noopErrorReporter,
                origin: () => origin,
                identify: async () => ({
                  ...member,
                  principal: { ...as(person), actorId: person.actorId },
                }),
              },
              released: async () => released,
              read: hostBallots,
            });
          const request = () =>
            new Request(`${origin}${hostBallotsPath(lobbyId, eventId)}`, {
              headers: { origin },
            });
          const response = await route()(request());
          assert({
            given: `the actual ${permission} viewer at the Ballots HTTP boundary`,
            should:
              'apply the area capability, closed release and no-store policy',
            actual: [
              response.status,
              response.headers.get('cache-control'),
              (await route(false)(request())).status,
            ],
            expected: [index === 0 ? 200 : 404, 'no-store', 404],
          });

          assert({
            given: `the actual ${permission} host area`,
            should:
              'list only its own real ballot Round addresses and require the ballots area',
            actual: listed?.rounds.map((row) => row.roundId) ?? null,
            expected: index === 0 ? [roundId] : null,
          });
          const [recorded] =
            await owner`select scores,winner from ballots where id=${ballotId}`;
          const ballotView =
            index === 0 ? await readBallot(person, roundId) : null;
          assert({
            given:
              'a genuinely submitted copied ballot and the current narrow role',
            should:
              'keep exact ballot content separate from every ordinary Room/Round video read',
            actual: [
              ballotView?.ballots[0]?.ballot.scores ?? null,
              ballotView?.ballots[0]?.ballot.winner ?? null,
              ballotView?.transcript ?? null,
              ballotView?.ballots[0]?.review ?? null,
              await hidden(() => runtime.operations.view(person, world.roomId)),
              await hidden(() => readVideo(person, roundId)),
              index === 1
                ? await hidden(() => readBallot(person, roundId))
                : true,
            ],
            expected: [
              index === 0 ? recorded!.scores : null,
              index === 0 ? recorded!.winner : null,
              null,
              index === 0 ? { ballotId, screening: 'clear' } : null,
              true,
              true,
              true,
            ],
          });
          const [grant] =
            await owner`select id from grants where lobby_id=${lobbyId} and user_id=${person.userId} and revoked_at is null`;
          const [current] =
            await owner`select version from lobbies where id=${lobbyId}`;
          const revoked = await command(as(world.bots.Director!), {
            version: 1,
            commandId: createId(),
            expected: { lobby: Number(current!.version) },
            command: {
              type: 'remove-grant',
              scope: { kind: 'lobby', lobbyId },
              grantId: String(grant!.id),
            },
          });
          assert({
            given:
              'the actual grant owner revoking the only role through its command',
            should:
              'remove the shell and every unreleased result without deleting its retained grant',
            actual: [
              revoked.kind,
              await navigation(as(person), { kind: 'lobby', id: lobbyId }),
              await standings(as(person), { lobbyId, eventId }),
              await hostBallots(as(person), { lobbyId, eventId }),
              await hostResults(as(person), { lobbyId, eventId }),
              (
                await owner`select revoked_at is not null ended from grants where id=${grant!.id}`
              )[0]!.ended,
            ],
            expected: ['accepted', null, null, null, null, true],
          });
          assert({
            given: 'that actual role after canonical revocation',
            should: 'conceal the retained private ballot as well',
            actual: await hidden(() => readBallot(person, roundId)),
            expected: true,
          });
        }
      },
    );
    await proveDrawArea({
      ...world,
      sql: owner,
      database: committingRuntimeTestDatabase(owner),
    });
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
