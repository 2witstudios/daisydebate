import { processRoute } from '../../../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute((routes) => (request) => {
  const parts = new URL(request.url).pathname.split('/');
  return routes.rounds.utterances(request, parts[3] ?? '', parts[5] ?? '');
});
