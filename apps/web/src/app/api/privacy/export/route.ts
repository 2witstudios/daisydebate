import { processRoute } from '../../../../server/process-app';
import { dataRightsComposition } from '../../../../features/account/data-rights/composition';

export const runtime = 'nodejs';
export const POST = processRoute(
  dataRightsComposition,
  (routes) => routes.export.POST,
);
