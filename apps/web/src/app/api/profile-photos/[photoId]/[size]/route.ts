import { processRoute } from '../../../../../server/process-app';
import { publicProfileComposition } from '../../../../../features/profile/public-profile-routes';
type Params = Awaited<
  RouteContext<'/api/profile-photos/[photoId]/[size]'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public: a published profile photo; its owner's photo in review (ADR 0143). */
export const GET = processRoute.withParams(
  publicProfileComposition,
  (routes) =>
    (request, { photoId, size }: Params) => {
      return routes.image(request, { photoId, size });
    },
);
