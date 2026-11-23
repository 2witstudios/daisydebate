import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startNotificationMail } from './mail-worker';

/** Notification email (ADR 0124, ADR 0144). */
export const startNotificationWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    notificationMail: startNotificationMail({
      app,
      waits,
      reporter: app.reporter,
    }),
  });
