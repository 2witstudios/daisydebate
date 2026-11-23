import { processRoute } from '../../../../server/process-app';
import { mailWebhookComposition } from '../../../../features/mail/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(
  mailWebhookComposition,
  (routes) => routes.POST,
);
