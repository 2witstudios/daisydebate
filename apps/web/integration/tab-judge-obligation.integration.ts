import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { settingCommand } from '../src/features/tab/operations/settings';
import { readHostRoster } from '../src/features/tab/reads/host-roster';
import { judgeObligationEnvelope } from '../src/features/tab/judge-obligation-form';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('host obligations resolve policy from the real chain and count accepted school entries and eligible judges', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, ['Director', 'Staff', 'Coach', 'Judge A', 'Judge B']),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      await leagueAdministrationStage(world);
      await setupStage(world);
      await judgeRegistrationStage(world);
      const store = createTabStore(database),
        read = readHostRoster({ store, authorize });
      const principal = as(world.bots.Director!),
        lobbyId = world.made.get('tournament-lobby')!,
        eventId = world.made.get('event')!;
      const school = createId(),
        otherSchool = createId();
      for (const id of [school, otherSchool])
        await sql`insert into organizations(id,kind,name,handle,owner_user_id) values(${id},'school',${id},${id},${world.bots.Director!.userId})`;
      for (const [schoolId, status] of [
        [school, 'accepted'],
        [school, 'accepted'],
        [school, 'accepted'],
        [school, 'pending'],
        [school, 'withdrawn'],
        [otherSchool, 'accepted'],
      ] as const)
        await sql`insert into entries(id,lobby_id,event_id,name,status,responsible_kind,school_organization_id) values(${createId()},${lobbyId},${eventId},'School entry',${status},'school',${schoolId})`;
      await sql`update tournament_judges set school_organization_id=${school} where lobby_id=${lobbyId}`;
      const before = await read(principal, { lobbyId, eventId });
      assert({
        given: 'no configured obligation',
        should: 'keep total and school obligations explicitly null',
        actual: [
          before?.entries.counts.judgesNeeded,
          before?.entries.groups.map((g) => g.judgesOwed),
        ],
        expected: [null, [null, null]],
      });
      const send = settingCommand({
        store,
        authorize,
        now: world.clock.now,
        newId: createId,
      });
      const [version] =
        await sql`select settings_version from events where id=${eventId}`;
      const form = new FormData();
      form.set('entries-per-judge', '2');
      form.set('judges-per-group', '1');
      const envelope = judgeObligationEnvelope(
        {
          eventId,
          handle: 'spring',
          settingsVersion: Number(version!.settings_version),
          commandId: createId(),
        },
        form,
      );
      assert({
        given: 'a member with no settings authority',
        should: 'deny policy edits through the real command',
        actual: await deniedAsNotFound(() =>
          send(as(world.bots.Coach!), envelope),
        ),
        expected: true,
      });
      const result = await send(principal, envelope);
      const replay = await send(principal, envelope);
      const configured = await read(principal, { lobbyId, eventId });
      const group = configured?.entries.groups.find(
        (g) =>
          g.responsible.kind === 'school' &&
          g.responsible.organizationId === school,
      );
      assert({
        given: 'a real policy saved by the versioned editor command',
        should:
          'owe two judges for three accepted entries, ignore pending/withdrawn entries, and keep schools separate',
        actual: [
          result.kind,
          replay.kind,
          configured?.entries.groups.reduce(
            (sum, group) => sum + (group.judgesOwed ?? 0),
            0,
          ),
          group?.judgesOwed,
          configured?.entries.groups.find(
            (g) =>
              g.responsible.kind === 'school' &&
              g.responsible.organizationId === otherSchool,
          )?.judgesOwed,
        ],
        expected: ['accepted', 'accepted', 3, 2, 1],
      });
      const stale = await send(principal, {
        ...envelope,
        commandId: createId(),
      });
      assert({
        given: 'a fresh command with the stale displayed version',
        should: 'refuse without changing obligations',
        actual: stale,
        expected: { kind: 'refused', refusal: 'version-conflict' },
      });
      const acceptedJudges = configured!.entries.counts.judges;
      assert({
        given: 'accepted eligible judges affiliated to one school',
        should: 'show the same accepted eligible has count in that school',
        actual: [group?.judgesNamed, acceptedJudges > 0],
        expected: [acceptedJudges, true],
      });
      await sql`update tournament_judges set status='withdrawn' where lobby_id=${lobbyId}`;
      const withdrawn = await read(principal, { lobbyId, eventId });
      assert({
        given: 'withdrawn school judges',
        should: 'no longer count them toward what the school has',
        actual: withdrawn?.entries.groups.find(
          (g) =>
            g.responsible.kind === 'school' &&
            g.responsible.organizationId === school,
        )?.judgesNamed,
        expected: 0,
      });
    },
  });
}, 30000);
