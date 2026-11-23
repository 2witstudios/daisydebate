import { readCompetitionAgeBand } from '../ladder-division-band';
import { readOfficialStandingLobbies } from '../official-standing-lobbies';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Daisy's official standing lobbies and a member's competition age band, on the browse lane. */
export const createLobbyStore = (resources: DatabaseResources) => {
  const browse = resourcesOf(resources).lane('browse').database;
  return namedLaneOperations({
    readOfficialStandingLobbies: () => readOfficialStandingLobbies(browse),
    readCompetitionAgeBand: (userId: string, lobbyId?: string) =>
      readCompetitionAgeBand(browse, userId, lobbyId),
  });
};
export type LobbyStore = ReturnType<typeof createLobbyStore>;
