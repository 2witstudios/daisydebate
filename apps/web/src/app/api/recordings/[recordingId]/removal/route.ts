import { processRoute } from '../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/recordings/[recordingId]/removal'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { recordingId }) =>
      routes.recordings.removal(request, recordingId),
);
