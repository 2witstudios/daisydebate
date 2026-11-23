import {
  notificationRetentionTarget,
  digestRetentionTarget,
} from './retention';
import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startNotificationMail } from './mail-worker';

/** Notification email (ADR 0124, ADR 0144). */
const startNotificationWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    notificationMail: startNotificationMail({
      app,
      waits,
      reporter: app.reporter,
    }),
  });

/** This feature in the web process: its background work and its retention targets. */
export const notificationsInProcess: ProcessFeature = {
  work: startNotificationWork,
  retention: ({ app }) => [
    notificationRetentionTarget(app.database),
    digestRetentionTarget(app.database),
  ],
};
