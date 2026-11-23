import { processRoute } from '../../../../../../../server/process-app';
import { mediaCaptureComposition } from '../../../../../../../features/media-capture/composition';

export const runtime = 'nodejs';
export const POST = processRoute(
  mediaCaptureComposition,
  (routes) => routes.handle,
);
