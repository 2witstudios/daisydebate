import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/profile-photos/[photoId]/[size]'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public: a published profile photo; its owner's photo in review (ADR 0143). */
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { photoId, size }) => {
      return routes.publicProfile.image(request, { photoId, size });
    },
);
