import { analyticsConsentOperations } from '../analytics-consent';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Analytics consent, on the control lane. */
export const createAnalyticsConsentStore = (resources: DatabaseResources) =>
  namedLaneOperations(
    analyticsConsentOperations(resourcesOf(resources).lane('control').database),
  );
