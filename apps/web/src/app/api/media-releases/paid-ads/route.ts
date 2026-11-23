import { processRoute } from '../../../../server/process-app';
import { mediaReleaseComposition } from '../../../../features/media-releases/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute(
  mediaReleaseComposition,
  (routes) => routes.paidAds,
);
