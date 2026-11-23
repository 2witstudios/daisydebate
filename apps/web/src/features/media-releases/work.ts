import { mediaReleaseRetentionTargets } from './retention';
import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startMediaReleaseMail } from './mail-worker';

/** Media release email (ADR 0151). */
const startMediaReleaseWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    mediaReleaseMail: startMediaReleaseMail({
      app,
      waits,
      reporter: app.reporter,
    }),
  });

/** This feature in the web process: its background work and its retention targets. */
export const mediaReleasesInProcess: ProcessFeature = {
  work: startMediaReleaseWork,
  retention: ({ app }) => [...mediaReleaseRetentionTargets(app.database)],
};
