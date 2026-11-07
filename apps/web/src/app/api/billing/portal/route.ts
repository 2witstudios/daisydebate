import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const POST = processRoute((routes) => routes.billing.portal.POST);
