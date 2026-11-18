import type { App } from '../../server/app';
import { memberHttpBoundary } from '../../server/member-boundary';
import { routeReleaseFor } from '../flags/route-release';
import { deriveRecipientSubkey } from '../mail/recipient-key';
import { composeMediaReleaseHandlers } from './handlers';
import { deriveReleaseStopSubkey } from './stop-token';

/** The media release routes, built from one app (ADR 0151). */
export const composeMediaReleaseRoutes = (app: App) =>
  composeMediaReleaseHandlers({
    boundary: memberHttpBoundary(app),
    released: (accountId) =>
      routeReleaseFor(app)('youth-publishing', accountId),
    recipientSubkey: () =>
      deriveRecipientSubkey(app.mailConfig().RECIPIENT_HASH_SECRET),
    stopSubkey: () =>
      deriveReleaseStopSubkey(app.mailConfig().RECIPIENT_HASH_SECRET),
    store: app.database,
  });
