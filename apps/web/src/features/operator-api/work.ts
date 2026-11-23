import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startOperatorApi } from './start-listener';

/**
 * ADR 0079: the private operator listener, only when keys are configured.
 * Its unexpected failures go to the app's scrubbed reporter (ADR 0037):
 * uninitialized without a DSN, so an unconfigured deployment stays inert.
 */
export const startOperatorApiWork = async ({ app }: ProcessWork) =>
  featureWork({ operatorApi: await startOperatorApi(app, app.reporter) });
