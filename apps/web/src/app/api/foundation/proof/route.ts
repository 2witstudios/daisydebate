import { processRoute } from '../../../../server/process-app';
import { foundationProofComposition } from '../../../../features/foundation/composition';

export const runtime = 'nodejs';

export const POST = processRoute(
  foundationProofComposition,
  (routes) => routes.POST,
);
export const GET = processRoute(
  foundationProofComposition,
  (routes) => routes.GET,
);
