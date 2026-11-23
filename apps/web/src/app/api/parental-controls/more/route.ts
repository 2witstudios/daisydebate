import { parentalControlsComposition } from '../../../../features/parental-controls/composition';
import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(
  parentalControlsComposition,
  (routes) => routes.more,
);
