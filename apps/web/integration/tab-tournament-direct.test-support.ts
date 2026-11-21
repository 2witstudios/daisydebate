import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { completionCommand } from '../src/features/tab/operations/completion-command';
import { settlePendingCommand } from '../src/features/tab/operations/confirmation-command';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { drawCompetition } from '../src/features/tab/operations/draw-competition';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { eventResultCommand } from '../src/features/tab/operations/event-result-command';
import { fixtureCommand } from '../src/features/tab/operations/fixture-command';
import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { resultCommand } from '../src/features/tab/operations/result-command';
import { sanctionCommand } from '../src/features/tab/operations/sanction-command';
import { settingCommand } from '../src/features/tab/operations/settings';
import { setupCommand } from '../src/features/tab/operations/setup';
import type { World } from './tab-tournament.test-support';

/** Shared stages also serve suites confined to a single uncommitted database transaction. */
export const directTournamentCommands = (world: World) => {
  const common = {
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  };
  return {
    organization: organizationCommand(common),
    lobbyAdministration: lobbyAdministrationCommand(common),
    setup: setupCommand(common),
    settings: settingCommand(common),
    entries: entryEnrollmentCommand(common),
    judges: judgeRegistrationCommand({
      ...common,
      minorsReleased: async () => false,
    }),
    draw: drawCommand({ ...common, competition: drawCompetition }),
    fixture: fixtureCommand(common),
    confirmation: settlePendingCommand(common),
    fixtureResult: resultCommand(common),
    eventResult: eventResultCommand(common),
    completion: completionCommand(common),
    sanction: sanctionCommand(common),
  };
};
