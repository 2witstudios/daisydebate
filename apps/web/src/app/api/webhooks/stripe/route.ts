import { billingWebhookComposition } from '../../../../features/billing/composition';
import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute(
  billingWebhookComposition,
  (routes) => routes.POST,
);
