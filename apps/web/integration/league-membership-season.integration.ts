import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { leagueSchoolCommand } from '../src/features/tab/operations/league-schools';
import { settingCommand } from '../src/features/tab/operations/settings';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { readLeagueSeason } from '../src/features/tab/reads/league-season';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import {
  createBots,
  scriptClock,
  type Bot,
} from './tab-tournament.test-support';
import {
  membershipCompetition,
  requireAccepted,
} from './league-membership-competition.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('membership seasons admit actual league/member hosts and only eligible entrants from certified competition', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
        'Director',
        'Member host',
        'Unrelated host',
        'School controller',
        'Direct entrant',
        'Active school entrant',
        'Invited school entrant',
        'Ended school entrant',
      ]),
    work: async (database, people, sql) => {
      const bots = Object.fromEntries(people.map((bot) => [bot.name, bot]));
      const director = bots.Director!,
        memberHost = bots['Member host']!,
        unrelatedHost = bots['Unrelated host']!,
        schoolController = bots['School controller']!,
        direct = bots['Direct entrant']!;
      const world = {
        database,
        sql,
        bots,
        clock: scriptClock(Date.now()),
        made: new Map<string, string>(),
      };
      const common = {
        store: createTabStore(database),
        authorize,
        now: world.clock.now,
        newId: createId,
      };
      for (const person of [director, memberHost, unrelatedHost])
        await seedHostingGrant(sql, person.userId);
      const organizations = organizationCommand(common);
      const createOrganization = async (
        controller: Bot,
        kind: 'league' | 'school',
        name: string,
      ) =>
        (
          await requireAccepted(
            organizations(as(controller), {
              version: 1,
              commandId: createId(),
              expected: {},
              command: {
                type: 'create-organization',
                kind,
                name,
                handle: `membership-${createId()}`,
              },
            }),
            `create ${name}`,
          )
        ).aggregate.id;
      const leagueId = await createOrganization(
        director,
        'league',
        'Automatic membership league',
      );
      const joinPerson = async (person: Bot) => {
        const [guard] =
          await sql`select version from organizations where id=${leagueId}`;
        await requireAccepted(
          organizations(as(director), {
            version: 1,
            commandId: createId(),
            expected: { organization: Number(guard!.version) },
            command: {
              type: 'invite-member',
              organizationId: leagueId,
              userId: person.userId,
            },
          }),
          'invite league member',
        );
        await requireAccepted(
          organizations(as(person), {
            version: 1,
            commandId: createId(),
            expected: {},
            command: { type: 'accept-membership', organizationId: leagueId },
          }),
          'accept direct league membership',
        );
      };
      await joinPerson(memberHost);
      await joinPerson(direct);
      const schoolCommands = leagueSchoolCommand(common);
      const school = async (
        name: string,
        state: 'active' | 'invited' | 'ended',
      ) => {
        const id = await createOrganization(schoolController, 'school', name);
        const [guard] =
          await sql`select version from organizations where id=${leagueId}`;
        await requireAccepted(
          schoolCommands(as(director), {
            version: 1,
            commandId: createId(),
            expected: { organization: Number(guard!.version) },
            command: { type: 'invite-league-school', leagueId, schoolId: id },
          }),
          'league invites school',
        );
        if (state !== 'invited')
          await requireAccepted(
            schoolCommands(as(schoolController), {
              version: 1,
              commandId: createId(),
              expected: { membership: 1 },
              command: { type: 'accept-league-school', leagueId, schoolId: id },
            }),
            'school assents',
          );
        if (state === 'ended')
          await requireAccepted(
            schoolCommands(as(schoolController), {
              version: 1,
              commandId: createId(),
              expected: { membership: 2 },
              command: {
                type: 'end-league-school',
                leagueId,
                schoolId: id,
                side: 'school',
              },
            }),
            'school ends membership',
          );
        return { id, controller: schoolController };
      };
      const activeSchool = await school('Active member school', 'active'),
        invitedSchool = await school('Invitation only school', 'invited'),
        endedSchool = await school('Ended school', 'ended');
      const template = await requireAccepted(
        settingCommand(common)(as(director), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-template',
            organizationId: leagueId,
            name: 'Automatic season series',
            format: { id: 'freestyle', version: 1 },
            ballotDefinition: null,
          },
        }),
        'league creates template',
      );
      const templateId = template.aggregate.id;
      const season = await requireAccepted(
        lobbyAdministrationCommand(common)(as(director), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-season',
            organizationId: leagueId,
            name: 'Membership season',
            startsAt: new Date(Date.now() - 86400000).toISOString(),
            endsAt: null,
            counting: 'membership',
            countsLobbyRooms: false,
            rule: {
              preliminaryWin: { points: 2, cap: null },
              eliminationRound: { points: 3 },
              bestEvents: null,
              topPerSchool: null,
            },
          },
        }),
        'create membership season',
      );
      const read = () =>
        readLeagueSeason(common)(as(director), {
          organizationId: leagueId,
          seasonId: season.aggregate.id,
          templateId,
        });
      const points = async () =>
        Object.fromEntries(
          (await read())!.view.standings.rows.map((row) => [
            row.entrant,
            row.points,
          ]),
        );
      const owned = { kind: 'organization', organizationId: leagueId } as const;
      await membershipCompetition(world, {
        host: director,
        owner: owned,
        entrant: direct,
        school: null,
        templateId,
        name: 'League hosted certified',
        certify: true,
      });
      assert({
        given:
          'a certified actual bye at a league-owned event following its template',
        should:
          'automatically award the direct member two season points without a sanction',
        actual: await points(),
        expected: { [`bot-${direct.userId}`]: 2 },
      });
      await membershipCompetition(world, {
        host: memberHost,
        owner: { kind: 'self' },
        entrant: bots['Active school entrant']!,
        school: activeSchool,
        templateId,
        name: 'Active member hosted certified',
        certify: true,
      });
      const expected = {
        [`bot-${direct.userId}`]: 2,
        [`bot-${bots['Active school entrant']!.userId}`]: 2,
      };
      assert({
        given:
          'a personal host who actually joined the league and an entrant represented by an assenting member school',
        should:
          'automatically award the school entrant two real certified points',
        actual: await points(),
        expected,
      });
      await membershipCompetition(world, {
        host: unrelatedHost,
        owner: { kind: 'self' },
        entrant: direct,
        school: null,
        templateId,
        name: 'Unrelated host with member entrant',
        certify: true,
      });
      assert({
        given:
          'a certified matching-template event with a member entrant but unrelated host',
        should:
          'award no additional points merely because the entrant belongs to the league',
        actual: await points(),
        expected,
      });
      await membershipCompetition(world, {
        host: director,
        owner: owned,
        entrant: direct,
        school: null,
        templateId: 's3tw1srulgcs6y2xhbog8gps',
        name: 'League host foreign template',
        certify: true,
      });
      assert({
        given:
          'a league-owned certified event following a different organization template',
        should: 'not count the unrelated series',
        actual: await points(),
        expected,
      });
      for (const [entrant, relation, name] of [
        [
          bots['Invited school entrant']!,
          invitedSchool,
          'Invited school winner',
        ],
        [bots['Ended school entrant']!, endedSchool, 'Ended school winner'],
      ] as const) {
        await membershipCompetition(world, {
          host: director,
          owner: owned,
          entrant,
          school: relation,
          templateId,
          name,
          certify: true,
        });
        assert({
          given: `a certified winner whose responsible school is ${name}`,
          should:
            'exclude the entrant until its school is an active member, without inferring membership from the controller',
          actual: await points(),
          expected,
        });
      }
      const uncertified = await membershipCompetition(world, {
        host: director,
        owner: owned,
        entrant: direct,
        school: null,
        templateId,
        name: 'Uncertified member event',
        certify: false,
      });
      assert({
        given:
          'an actual published bye and recorded result without certification',
        should:
          'retain certified points and identify the event awaiting certification',
        actual: [
          await points(),
          (await read())!.view.standings.awaitingCertification.map(
            (event) => event.lobbyId,
          ),
        ],
        expected: [expected, [uncertified.lobbyId]],
      });
      await uncertified.certify();
      assert({
        given: 'the host certifying that real recorded competition',
        should: 'add exactly the newly certified two points',
        actual: await points(),
        expected: { ...expected, [`bot-${direct.userId}`]: 4 },
      });
      // Membership is counted as it stood when each event ran. Test events
      // start after database time, so periods are placed relative to them.
      const startOf = async (name: string) => {
        const [lobby] =
          await sql`select id from lobbies where name=${name} and kind='tournament'`;
        await sql`select set_config('daisy.organization_scope', '', true), set_config('daisy.lobby_scope', ${lobby!.id}, true)`;
        const [slot] =
          await sql`select min(starts_at) at from time_slots where lobby_id=${lobby!.id}`;
        return slot!.at as Date;
      };
      const dayAfter = (at: Date) => new Date(at.getTime() + 86_400_000);
      const settled = { ...expected, [`bot-${direct.userId}`]: 4 };
      const activeEnd = await schoolCommands(as(schoolController), {
        version: 1,
        commandId: createId(),
        expected: { membership: 2 },
        command: {
          type: 'end-league-school',
          leagueId,
          schoolId: activeSchool.id,
          side: 'school',
        },
      });
      const activeEndedAt = dayAfter(
        await startOf('Active member hosted certified'),
      );
      await sql`select set_config('daisy.organization_scope', ${leagueId}, true), set_config('daisy.lobby_scope', '', true)`;
      await sql`update league_schools set ended_at=${activeEndedAt} where organization_id=${leagueId} and school_id=${activeSchool.id}`;
      assert({
        given:
          'a member school that ended its membership after its certified event',
        should: 'keep the points its entrant earned while it was a member',
        actual: [activeEnd.kind, await points()],
        expected: ['accepted', settled],
      });
      const invitedJoin = await schoolCommands(as(schoolController), {
        version: 1,
        commandId: createId(),
        expected: { membership: 1 },
        command: {
          type: 'accept-league-school',
          leagueId,
          schoolId: invitedSchool.id,
        },
      });
      const invitedJoinedAt = dayAfter(await startOf('Invited school winner'));
      await sql`select set_config('daisy.organization_scope', ${leagueId}, true), set_config('daisy.lobby_scope', '', true)`;
      await sql`update league_schools set joined_at=${invitedJoinedAt} where organization_id=${leagueId} and school_id=${invitedSchool.id}`;
      assert({
        given: 'a school whose membership began after its entrant’s event',
        should: 'gain no points from before it joined',
        actual: [invitedJoin.kind, await points()],
        expected: ['accepted', settled],
      });
      // A person's membership row is reopened on a rejoin; their earlier
      // period must still count for the event they hosted in it.
      const hostLeft = await organizations(as(memberHost), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'end-membership',
          organizationId: leagueId,
          userId: memberHost.userId,
        },
      });
      const hostEndedAt = dayAfter(
        await startOf('Active member hosted certified'),
      );
      await sql`select set_config('daisy.organization_scope', ${leagueId}, true), set_config('daisy.lobby_scope', '', true)`;
      await sql`update membership_periods set ended_at=${hostEndedAt} where organization_id=${leagueId} and user_id=${memberHost.userId}`;
      const [guard] =
        await sql`select version from organizations where id=${leagueId}`;
      const reinvited = await organizations(as(director), {
        version: 1,
        commandId: createId(),
        expected: { organization: Number(guard!.version) },
        command: {
          type: 'invite-member',
          organizationId: leagueId,
          userId: memberHost.userId,
        },
      });
      await sql`select set_config('daisy.organization_scope', ${leagueId}, true), set_config('daisy.lobby_scope', '', true)`;
      const periods =
        await sql`select ended_at is not null as ended from membership_periods where organization_id=${leagueId} and user_id=${memberHost.userId}`;
      assert({
        given:
          'a member host who left after hosting a counted event and was invited back',
        should:
          'keep their earlier period, so the event they hosted still counts',
        actual: [hostLeft.kind, reinvited.kind, periods, await points()],
        expected: ['accepted', 'accepted', [{ ended: true }], settled],
      });
    },
  });
}, 60000);
