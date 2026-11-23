import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startOperatorApi } from './start-listener';

/**
 * ADR 0079: the private operator listener, only when keys are configured.
 * Its unexpected failures go to the app's scrubbed reporter (ADR 0037):
 * uninitialized without a DSN, so an unconfigured deployment stays inert.
 */
const startOperatorApiWork = async ({ app }: ProcessWork) =>
  featureWork({ operatorApi: await startOperatorApi(app, app.reporter) });

/** This feature in the web process: its background work. */
export const operatorApiInProcess: ProcessFeature = {
  work: startOperatorApiWork,
};
