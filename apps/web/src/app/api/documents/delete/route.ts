import { processRoute } from '../../../../server/process-app';
import { documentComposition } from '../../../../features/documents/composition';

export const runtime = 'nodejs';

export const POST = processRoute(
  documentComposition,
  (routes) => routes.delete.POST,
);
