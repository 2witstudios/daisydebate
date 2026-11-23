import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startMediaReleaseMail } from './mail-worker';

/** Media release email (ADR 0151). */
export const startMediaReleaseWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    mediaReleaseMail: startMediaReleaseMail({
      app,
      waits,
      reporter: app.reporter,
    }),
  });
