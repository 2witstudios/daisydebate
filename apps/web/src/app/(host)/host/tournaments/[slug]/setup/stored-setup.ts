import { lobbySetupViewSchema } from '@daisy/protocol/lobby/lobby-setup-read';
import { tournamentEventSettingsViewSchema } from '@daisy/protocol/lobby/resolved-settings-read';
import { tournamentSetupPath } from '../../../../../../features/tab/tournament-setup-route';
import { tournamentEventSettingsPath } from '../../../../../../features/tab/tournament-event-settings-route';
import {
  storedSetupOf,
  setupRailOf,
} from '../../../../../../features/tab/stored-setup';
import { requestNow } from '../../../../../../lib/request-session';
import { GET as setupGET } from '../../../../../api/tab/tournament-setup/route';
import { GET as settingsGET } from '../../../../../api/tab/tournament-event-settings/route';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';

/** Both reads use the actual request's evaluated HTTP boundary; the settings guard travels with its values. */
export async function readStoredSetup(handle: string, eventId: string | null) {
  const view = await readOwnRoute(
    setupGET,
    tournamentSetupPath(handle),
    lobbySetupViewSchema,
  );
  if (!view || view.kind !== 'tournament') return null;
  const rail = setupRailOf(view);
  const event =
    eventId === null
      ? view.events[0]
      : view.events.find((one) => one.eventId === eventId);
  if (!event)
    return view.events.length === 0 && eventId === null
      ? { kind: 'empty' as const, rail, view }
      : null;
  const settings = await readOwnRoute(
    settingsGET,
    tournamentEventSettingsPath(view.lobbyId, event.eventId),
    tournamentEventSettingsViewSchema,
  );
  if (!settings) return null;
  const setup = storedSetupOf(view, settings, requestNow());
  return setup
    ? { kind: 'configured' as const, rail, view, event, settings, setup }
    : null;
}
