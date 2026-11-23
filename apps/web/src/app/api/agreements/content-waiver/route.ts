import { processRoute } from '../../../../server/process-app';
import { agreementComposition } from '../../../../features/agreements/composition';

export const runtime = 'nodejs';
export const POST = processRoute(
  agreementComposition,
  (routes) => routes.contentWaiver.POST,
);
