import { processRoute } from '../../../../server/process-app';
import { challengeComposition } from '../../../../features/challenges/composition';
export const runtime = 'nodejs';
export const POST = processRoute(
  challengeComposition,
  (routes) => routes.cancel,
);
