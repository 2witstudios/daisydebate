import { createAppError } from '@daisy/errors';
import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import {
  createTabCommandRoute,
  type TabCommandRouteDependencies,
} from './command-route';
import {
  lobbyAdministrationCommand,
  isLobbyAdministration,
} from './operations/lobby-administration';
import { setupCommand } from './operations/setup';
export type LobbyCommandRouteDependencies = Parameters<
  typeof lobbyAdministrationCommand
>[0] &
  Parameters<typeof setupCommand>[0] &
  Pick<TabCommandRouteDependencies, 'boundary' | 'released'>;
/** The production dispatch shares the exact administration/setup decision seam with its authoring proofs. */
export function createLobbyCommandRoute(
  dependencies: LobbyCommandRouteDependencies,
) {
  const administration = lobbyAdministrationCommand(dependencies),
    setup = setupCommand(dependencies);
  return createTabCommandRoute({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.lobby.command',
    address: 'none',
    execute: (principal, body) => {
      const envelope = lobbySetupCommandEnvelopeSchema.safeParse(body);
      if (!envelope.success) throw createAppError('VALIDATION');
      return isLobbyAdministration(envelope.data.command)
        ? administration(principal, body)
        : setup(principal, body);
    },
  });
}
