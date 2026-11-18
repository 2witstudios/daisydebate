import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { settingCommand } from '../src/features/tab/operations/settings';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import { draftDrawStage } from './tab-tournament-draw-draft.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';
/** Both existing template modes use actual commands; copying never fabricates an offer for a tournament. */
export const preparePublication = async (
  world: World,
  template: 'follow' | 'copy',
  beforeEntries: (world: World) => Promise<void> = async () => {},
  options: { readonly tournamentOwner?: 'personal' | 'organization' } = {},
) => {
  await organizationStage(world);
  await leagueAdministrationStage(world, options);
  await setupStage(world);
  if (template === 'copy') {
    const eventId = world.made.get('event')!;
    for (const command of [
      { type: 'stop-following-template', eventId } as const,
      {
        type: 'copy-template',
        eventId,
        templateId: 's3tw1srulgcs6y2xhbog8gps',
      } as const,
    ]) {
      const [event] =
        await world.sql`select version,entries_version,settings_version from events where id=${eventId}`;
      const answer = await settingCommand({
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
        command,
      });
      if (answer.kind !== 'accepted')
        throw new Error(
          `Copy template preparation refused: ${JSON.stringify(answer)}`,
        );
    }
  }
  await beforeEntries(world);
  for (const stage of [
    entryEnrollmentStage,
    judgeRegistrationStage,
    draftDrawStage,
  ])
    await stage(world);
};
