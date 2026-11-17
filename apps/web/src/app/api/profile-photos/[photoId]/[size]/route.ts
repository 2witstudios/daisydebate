import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Public: a published profile photo; its owner's photo in review (ADR 0143). */
export const GET = processRoute((routes) => (request) => {
  const [, , , photoId = '', size = ''] = new URL(request.url).pathname.split(
    '/',
  );
  return routes.publicProfile.image(request, { photoId, size });
});
