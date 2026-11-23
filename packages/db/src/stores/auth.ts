import { authOperations } from '../auth-operations';
import { authorizationSessionOperations } from '../authorization-session';
import { provisionalRetentionOperations } from '../provisional-retention';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Sign-in records, provisional account retention and the request's authorization session, on the control lane. */
export const createAuthStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...authOperations({ database: control, eventSink }),
    ...provisionalRetentionOperations({ database: control, eventSink }),
    ...authorizationSessionOperations({ database: control }),
  });
};
export type AuthStore = ReturnType<typeof createAuthStore>;
export type {
  ProvisionalLinkPurposes,
  ProvisionalMailCleanup,
} from '../provisional-cleanup';
