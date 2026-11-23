import { featureWork, type ProcessWork } from '../../server/feature-work';
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
