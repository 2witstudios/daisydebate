import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { settingCommand } from '../src/features/tab/operations/settings';
import { as } from './tab-tournament-organization-wiring.test-support';
import { requireTestServices } from '@daisy/config';
import {
  committingRuntimeTestDatabase,
  scratchDatabase,
} from '@daisy/db/testing';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import { draftDrawStage } from './tab-tournament-draw-draft.test-support';
import { publishDrawStage } from './tab-tournament-publication.test-support';
import { officiatingStage } from './tab-tournament-officiating.test-support';
import { resultsStage } from './tab-tournament-results.test-support';
import { standingsStage } from './tab-tournament-standings.test-support';
import { completionStage } from './tab-tournament-completion.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
import { readNotificationItems } from '../src/features/notifications/read-notifications';
import { withTournamentNotificationReader } from './tab-tournament-notifications.test-support';
import { notificationsStage } from './tab-tournament-notifications.test-support';
import {
  proveDraftJudgeChangesStaySilent,
  proveTournamentNotificationChanges,
} from './tab-notification-changes.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
for (const immediate of [false, true])
  test(`actual tournament notifications with ${immediate ? 'already open' : 'completion'} releases`, async () => {
    const scratch = scratchDatabase(databaseUrl, 'tabnotifications');
    await scratch.create();
    const owner = new SQL(scratch.url, { max: 4 });
    try {
      await scratch.migrate(() => true);
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
      const world = {
        database: committingRuntimeTestDatabase(owner),
        sql: owner,
        runtimeDatabaseUrl: scratch.url,
        clock: scriptClock(Date.now() - 60 * 60_000),
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        made: new Map<string, string>(),
      };
      for (const stage of [
        organizationStage,
        leagueAdministrationStage,
        leagueConfigurationStage,
        setupStage,
        entryEnrollmentStage,
        judgeRegistrationStage,
        draftDrawStage,
        publishDrawStage,
        proveTournamentNotificationChanges,
        officiatingStage,
        resultsStage,
        standingsStage,
        completionStage,
        notificationsStage,
      ]) {
        await stage(world);
        if (stage === setupStage && immediate) {
          const eventId = world.made.get('event')!;
          const [event] =
            await owner`select version,entries_version,settings_version from events where id=${eventId}`;
          const configured = await settingCommand({
            store: createTabStore(world.database),
            authorize,
            now: world.clock.now,
            newId: createId,
          })(as(world.bots.Director!), {
            version: 1,
            commandId: createId(),
            expected: {
              event: Number(event!.version),
              entries: Number(event!.entries_version),
              settings: Number(event!.settings_version),
            },
            command: {
              type: 'set-setting',
              scope: { kind: 'event', id: eventId },
              key: 'audience.decision',
              value: {
                responsible_adults: 'at_once',
                competitors: 'at_once',
                participants: 'at_once',
                link: 'never',
                public: 'never',
              },
              hold: 'default',
            },
          });
          if (configured.kind !== 'accepted')
            throw new Error(
              `Immediate release configuration refused: ${JSON.stringify(configured)}`,
            );
        }
        if (stage === officiatingStage) {
          await withTournamentNotificationReader(world, async (store) => {
            const actual = await readNotificationItems(store, {
              userId: world.bots['Judge C']!.userId,
              unreadOnly: false,
              now: new Date().toISOString(),
            });
            assert({
              given:
                'the real incoming replacement judge after second-person confirmation',
              should:
                'receive their assignment and the currently ready Room without borrowing the outgoing judge notice',
              actual: [
                actual.items.some(
                  (item) => item.text === 'You have been assigned to judge.',
                ),
                actual.items.some(
                  (item) => item.text === 'Your tournament Room is ready.',
                ),
              ],
              expected: [true, true],
            });
          });
        }
        if (stage === draftDrawStage || stage === publishDrawStage) {
          const judged =
            await owner`select n.user_id,count(*)::int n from notifications n where n.notification_lobby_id=${world.made.get('tournament-lobby')!} and n.kind in ('judge_assigned','judge_replaced','judge_unassigned') group by n.user_id`;
          assert({
            given: 'judges placed on a draft draw, then the draw published',
            should:
              'tell no judge about the draft and each placed judge exactly once on publication',
            actual:
              stage === draftDrawStage
                ? judged.length
                : judged.length > 0 && judged.every((row: { n: number }) => row.n === 1),
            expected: stage === draftDrawStage ? 0 : true,
          });
        }
        if (stage === publishDrawStage || stage === resultsStage) {
          const [count] =
            await owner`select count(*)::int n from notifications where notification_lobby_id=${world.made.get('tournament-lobby')!} and kind='tournament_results_released'`;
          assert({
            given:
              'a real recorded opening, before or after actual results exist',
            should:
              'notify of results only once the actual result is available under its already-open release',
            actual: count!.n > 0,
            expected: stage === resultsStage && immediate,
          });
        }
      }
    } finally {
      await owner.close();
      await scratch.drop();
    }
  }, 90_000);

test('judge changes on a draft draw notify nobody', async () => {
  const scratch = scratchDatabase(databaseUrl, 'tabdraftnotices');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
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
    const world = {
      database: committingRuntimeTestDatabase(owner),
      sql: owner,
      runtimeDatabaseUrl: scratch.url,
      clock: scriptClock(Date.now() - 60 * 60_000),
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      made: new Map<string, string>(),
    };
    for (const stage of [
      organizationStage,
      leagueAdministrationStage,
      leagueConfigurationStage,
      setupStage,
      entryEnrollmentStage,
      judgeRegistrationStage,
      draftDrawStage,
    ])
      await stage(world);
    await proveDraftJudgeChangesStaySilent(world);
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 60_000);
