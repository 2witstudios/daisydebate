import { memberCardOperations } from '../member-cards';
import { memberProfileReadOperations } from '../member-profile-reads';
import { publicProfileOperations } from '../public-profile-operations';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Public profiles and member cards on the social lane; their rating reads on the browse lane. */
export const createProfileStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const social = lane('social').database;
  const browse = lane('browse').database;
  return namedLaneOperations({
    ...publicProfileOperations({ database: social, eventSink }),
    ...memberCardOperations({
      database: social,
      ratingDatabase: browse,
      eventSink,
    }),
    ...memberProfileReadOperations({ database: browse, eventSink }),
  });
};
export type ProfileStore = ReturnType<typeof createProfileStore>;
export type {
  OwnPublicProfile,
  PhotoDeletion,
  PublicProfileCard,
} from '../public-profile-operations';
