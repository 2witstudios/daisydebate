import { processRoute } from '../../../../server/process-app';
import { composeBillingWebhook } from '../../../../server/billing-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute((_routes, app) => composeBillingWebhook(app));
