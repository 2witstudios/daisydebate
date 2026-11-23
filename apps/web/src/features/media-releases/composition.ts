import { defineComposition } from '../../server/composition';
import { nowMs } from '@daisy/clock';
import type { App } from '../../server/app';
import { memberHttpBoundary } from '../auth/member-boundary';
import { deriveRecipientSubkey } from '../mail/recipient-key';
import { composeMediaReleaseHandlers } from './handlers';
import { deriveReleaseStopSubkey } from './stop-token';

/** The media release routes, built from one app (ADR 0151). */
const composeMediaReleaseRoutes = (app: App) =>
  composeMediaReleaseHandlers({
    boundary: memberHttpBoundary(app),
    nowMs: () => nowMs(app.clock),
    recipientSubkey: () =>
      deriveRecipientSubkey(app.mailConfig().RECIPIENT_HASH_SECRET),
    stopSubkey: () =>
      deriveReleaseStopSubkey(app.mailConfig().RECIPIENT_HASH_SECRET),
    store: app.database,
  });

/** media-releases: its route files bind here (`processRoute`). */
export const mediaReleaseComposition = defineComposition(
  'media-releases',
  (app) => composeMediaReleaseRoutes(app),
);
