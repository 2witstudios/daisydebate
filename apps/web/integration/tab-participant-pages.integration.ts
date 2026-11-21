import { noopErrorReporter } from '@daisy/observability';
import { createId } from '@paralleldrive/cuid2';
import { releaseAudiences } from '@daisy/protocol/release-audience';
import { settingValueSchemas } from '@daisy/protocol/setting-values';
import { releaseCommandEnvelopeSchema } from '@daisy/protocol/lobby/result-command';
import {
  hostResolutions,
  roundReleaseEnvelope,
} from '../src/features/tab/host-resolutions';
import { readHostEvents } from '../src/features/tab/reads/host-events';
import { readHostResults } from '../src/features/tab/reads/host-results';
import { hostResultsScreenOf } from '../src/features/tab/results';
import { completionEnvelope } from '../src/features/tab/completion-form';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { createParticipantPageRoute } from '../src/features/tab/participant-page-route';
import {
  participantPagePath,
  postingPageSchema,
} from '../src/features/tab/participant-page-read';
import { releaseCommand } from '../src/features/tab/operations/release-command';
import { settingCommand } from '../src/features/tab/operations/settings';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import { draftDrawStage } from './tab-tournament-draw-draft.test-support';
import { publishDrawStage } from './tab-tournament-publication.test-support';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readParticipantTournament,
  readTournamentDirectory,
} from '../src/features/tab/reads/participant-tournament';
import { readParticipantResults } from '../src/features/tab/reads/participant-results';
import { readHostNavigation } from '../src/features/tab/reads/host-navigation';
import { authorize } from '@daisy/auth/authorization';
import { hostTimeSlot } from '../src/features/tab/host-time-slot';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import {
  createBots,
  scriptClock,
  type World,
} from './tab-tournament.test-support';

setupRitewayBun();

test('stored tournament pages only project the addressed and authorized schedule', async () => {
  const { databaseUrl } = requireTestServices(process.env);
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
        'Director',
        'Staff',
        'Release official',
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
      const world: World = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(),
        made: new Map(),
      };
      await organizationStage(world);
      await leagueAdministrationStage(world, {
        tournamentOwner: 'organization',
      });
      await leagueConfigurationStage(world);
      await setupStage(world);
      const store = createTabStore(database);
      const director = as(world.bots.Director!);
      const outsider = as(world.bots.Coach!);
      const lobbyId = world.made.get('tournament-lobby')!;
      const eventId = world.made.get('event')!;
      const roundId = world.made.get('tab-round')!;
      const tournament = await readParticipantTournament(
        store,
        director,
        lobbyId,
        null,
      );
      const denied = await readParticipantTournament(
        store,
        outsider,
        lobbyId,
        null,
      );
      const folder = await readTournamentDirectory(store, outsider, '');
      const unreleased = await readParticipantTournament(
        store,
        director,
        lobbyId,
        { eventId, roundId },
      );
      const results = await readParticipantResults(
        store,
        outsider,
        { lobbyId, eventId },
        'standings',
      );
      const readNavigation = readHostNavigation({
        store,
        authorize,
        now: world.clock.now,
      });
      const host = await readNavigation(director, {
        kind: 'lobby',
        id: lobbyId,
      });
      assert({
        given:
          'a real stored event with a resolution and time slot, before draw publication',
        should:
          'show the schedule to its host and withhold the tournament, unreleased result and posting from ineligible viewers',
        actual: [
          tournament?.schedule.map((row) => [
            row.event,
            row.round,
            row.posted,
            row.resolution,
          ]),
          denied,
          folder?.rows.some((row) => row.handle === tournament?.handle),
          unreleased,
          results,
        ],
        expected: [
          [['Varsity', 'Round 1', false, null]],
          null,
          false,
          null,
          null,
        ],
      });
      const slotId = host?.schedule?.slots[0]?.timeSlotId;
      const slot = host && slotId ? hostTimeSlot(host, slotId, eventId) : null;
      assert({
        given: 'the fenced host navigation and the stored slot',
        should: 'list the scheduled round under its event',
        actual: [
          slot?.title,
          slot?.events.flatMap((group) =>
            group.rounds.map((round) => round.tabRoundId),
          ),
        ],
        expected: ['Morning', [roundId]],
      });
      await entryEnrollmentStage(world);
      await judgeRegistrationStage(world);
      const dependencies = {
        store,
        authorize,
        now: world.clock.now,
        newId: createId,
      };
      const [state] = await sql`select handle from lobbies where id=${lobbyId}`;
      if (!state) throw new Error('The tournament address is missing');
      const [event] =
        await sql`select settings_version from events where id=${eventId}`;
      const manualPosting = settingValueSchemas['audience.posting'].parse(
        Object.fromEntries(
          releaseAudiences.map((audience) => [audience, 'manual']),
        ),
      );
      const policy = await settingCommand(dependencies)(director, {
        version: 1,
        commandId: createId(),
        expected: { settings: Number(event?.settings_version) },
        command: {
          type: 'set-setting',
          scope: { kind: 'event', id: eventId },
          key: 'audience.posting',
          hold: 'default',
          value: manualPosting,
        },
      });
      if (policy.kind !== 'accepted')
        throw new Error(`Posting policy failed: ${JSON.stringify(policy)}`);
      await draftDrawStage(world);
      await publishDrawStage(world);
      const releaseOfficial = as(world.bots['Release official']!);
      const [owner] =
        await sql`select owner_organization_id, version from lobbies where id=${lobbyId}`;
      if (!owner?.owner_organization_id)
        throw new Error('The tournament owner is missing');
      const roleId = createId(),
        organizationId = String(owner.owner_organization_id);
      // The role editor is separate. The actual guarded command grants this real permission row.
      await sql`insert into roles(id,organization_id,name,rank,preset) values(${roleId},${organizationId},'Release only',61,false)`;
      await sql`insert into role_permissions(role_id,organization_id,permission) values(${roleId},${organizationId},'tournament.results.release')`;
      const grant = await organizationCommand(dependencies)(director, {
        version: 1,
        commandId: createId(),
        expected: { lobby: Number(owner.version) },
        command: {
          type: 'give-grant',
          scope: { kind: 'lobby', lobbyId },
          userId: releaseOfficial.userId,
          roleId,
          expiresAt: null,
        },
      });
      if (grant.kind !== 'accepted')
        throw new Error('The narrow release grant was refused');
      const route = (signedIn: boolean, released = true) =>
        createParticipantPageRoute({
          store,
          boundary: {
            logger: silentLogger,
            reporter: noopErrorReporter,
            origin: () => origin,
            identify: async () =>
              signedIn
                ? {
                    ...member,
                    principal: {
                      ...director,
                      actorId: world.bots.Director!.actorId,
                    },
                  }
                : { state: 'anonymous', principal: { kind: 'anonymous' } },
          },
          released: async () => released,
        });
      const request = (headers?: HeadersInit) =>
        new Request(
          `${origin}${participantPagePath({ view: 'posting', handle: String(state.handle), eventId, roundId })}`,
          headers ? { headers } : undefined,
        );
      const beforeHost = postingPageSchema.parse(
        await (await route(true)(request())).json(),
      );
      assert({
        given: 'a published draw with every posting held for manual opening',
        should:
          'show the host its fixtures with the wording held and refuse a signed-out read',
        actual: [
          beforeHost.selected.fixtures.length,
          beforeHost.selected.resolution,
          (await route(false)(request())).status,
        ],
        expected: [2, null, 404],
      });
      for (const audience of releaseAudiences) {
        const authoring = await readHostEvents(dependencies)(director, lobbyId);
        const projected =
          authoring &&
          hostResolutions(
            authoring,
            eventId,
            createId,
            { method: 'fixed', release: 'with_posting' },
            manualPosting,
          );
        const action = projected?.rounds.find(
          (round) => round.id === roundId,
        )?.openPosting;
        if (action?.command.audience !== audience)
          throw new Error(`Host action did not offer the ${audience} opening`);
        let envelope = roundReleaseEnvelope(action.command);
        const first = audience === releaseAudiences[0];
        const official = first ? releaseOfficial : director;
        if (first) {
          const resultPage = await readHostResults(dependencies)(official, {
            eventId,
            lobbyId,
          });
          const navigation = await readNavigation(official, {
            kind: 'lobby',
            id: lobbyId,
          });
          const hostEvents = await readHostEvents(dependencies)(
            official,
            lobbyId,
          );
          const screen =
            navigation &&
            resultPage &&
            hostResultsScreenOf(navigation, resultPage, createId);
          const release = screen?.results.postingOpenings?.[0]?.release;
          assert({
            given:
              'an official with only the result release grant before the first posting opens',
            should:
              'conceal Setup authoring and offer that narrow posting release in Results',
            actual: [hostEvents, resultPage?.results.postingOpenings],
            expected: [
              null,
              [{ tabRoundId: roundId, tabRoundName: 'Round 1', audience }],
            ],
          });
          if (
            release?.kind !== 'command' ||
            release.command.target.type !== 'open-audience' ||
            release.command.target.thing !== 'posting'
          )
            throw new Error('Expected the typed Results posting command');
          envelope = releaseCommandEnvelopeSchema.parse(
            completionEnvelope(release.command, new FormData()),
          );
        }
        const send = releaseCommand(dependencies);
        const opened = await send(official, lobbyId, envelope);
        if (opened.kind !== 'accepted')
          throw new Error(
            `Opening ${audience} failed: ${JSON.stringify(opened)}`,
          );
        if (first) {
          const replay = await send(official, lobbyId, envelope);
          const next = await readHostResults(dependencies)(official, {
            eventId,
            lobbyId,
          });
          assert({
            given:
              'the same projected release command after losing its response',
            should: 'confirm the stored receipt without reopening the audience',
            actual: [
              replay.kind === 'accepted' && replay.receipt.replayed,
              next?.results.postingOpenings?.map((one) => one.audience),
            ],
            expected: [true, [releaseAudiences[1]]],
          });
        }
        if (audience === 'competitors') {
          const [competitor, unrelated] = [
            await readParticipantTournament(
              store,
              as(world.bots['Debater 1']!),
              lobbyId,
              { eventId, roundId },
            ),
            await readParticipantTournament(store, outsider, lobbyId, {
              eventId,
              roundId,
            }),
          ];
          assert({
            given:
              'two published fixtures when only the narrower audiences have opened',
            should:
              'show the competitor only their own posted fixture and withhold the round from an unrelated member',
            actual: [
              competitor?.selected?.fixtures.map((fixture) => fixture.own),
              unrelated,
            ],
            expected: [[true], null],
          });
        }
        if (audience === 'link')
          assert({
            given: 'a stored link-only posting before the public opening',
            should:
              'answer its direct address without a session and refuse a cross-site API request',
            actual: [
              (await route(false)(request())).status,
              (await route(false)(request({ 'sec-fetch-site': 'cross-site' })))
                .status,
            ],
            expected: [200, 403],
          });
      }
      const publicResponse = await route(false)(request());
      const posting = postingPageSchema.parse(await publicResponse.json());
      const expectedNames = beforeHost.selected.fixtures.flatMap(
        (fixture) => fixture.entries,
      );
      const publicNames = posting.selected.fixtures.flatMap(
        (fixture) => fixture.entries,
      );
      assert({
        given: 'the same two stored fixtures after the public opening',
        should:
          'release the pinned resolution and return initials only on the signed-out posting',
        actual: [
          publicResponse.status,
          posting.selected.resolution,
          publicNames.length,
          publicNames.every(
            (name) =>
              /^(?:[A-Z]\. ?){1,4}$/.test(name) &&
              !expectedNames.includes(name),
          ),
          (await route(false, false)(request())).status,
        ],
        expected: [
          200,
          'Public libraries should receive more funding.',
          4,
          true,
          404,
        ],
      });
    },
  });
});
