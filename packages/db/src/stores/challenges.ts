import { inTransaction } from '../tx';
import { readProfileChallengeModes } from '../challenges/lobby';
import {
  challengeReadOperations,
  createChallengeStore,
} from '../challenges/store';
import type { ContactAuthorizationFence } from '../contacts/fence';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Challenges: reads and commands on the social lane; a profile's challenge modes on the browse lane. */
export const createChallengesStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const social = lane('social').database;
  const browse = lane('browse').database;
  return namedLaneOperations({
    ...challengeReadOperations({ database: social, eventSink }),
    challengeStore: (authorize: ContactAuthorizationFence) =>
      createChallengeStore({ database: social, authorize }),
    readProfileChallengeModes: (userId: string, username: string) =>
      inTransaction(browse, (tx) =>
        readProfileChallengeModes(tx, userId, username),
      ),
  });
};
export type ChallengesStore = ReturnType<typeof createChallengesStore>;
