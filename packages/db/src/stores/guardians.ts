import {
  hasGuardianLobbyWaiver,
  readGuardianLobbyIds,
} from '../guardians/lobby-permissions';
import { createLobbyPermissionStore } from '../guardians/lobby-requests';
import { expireGuardianRequests } from '../guardians/retention';
import { createGuardianStore } from '../guardians/store';
import { inTransaction } from '../tx';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Guardian links, lobby permissions and their retention on the control lane; waiver reads on the browse lane. */
export const createGuardiansStore = (resources: DatabaseResources) => {
  const { lane } = resourcesOf(resources);
  const control = lane('control').database;
  const browse = lane('browse').database;
  return namedLaneOperations({
    guardians: createGuardianStore(control),
    lobbyPermissions: createLobbyPermissionStore(control),
    expireGuardianRequests: (limit: number) =>
      expireGuardianRequests(control, limit),
    readGuardianLobbyIds: (userId: string) =>
      inTransaction(browse, (tx) => readGuardianLobbyIds(tx, userId)),
    hasGuardianLobbyWaiver: (
      input: Parameters<typeof hasGuardianLobbyWaiver>[1],
    ) => inTransaction(browse, (tx) => hasGuardianLobbyWaiver(tx, input)),
  });
};
export type GuardiansStore = ReturnType<typeof createGuardiansStore>;
export type { GuardianLinkRow, GuardianSession } from '../guardians/store';
