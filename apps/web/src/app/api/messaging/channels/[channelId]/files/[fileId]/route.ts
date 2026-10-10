import { processRoute } from '../../../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute((routes) => (request) => {
  const parts = new URL(request.url).pathname.split('/');
  return routes.messaging.files.download(
    request,
    parts[4] ?? '',
    parts[6] ?? '',
  );
});
