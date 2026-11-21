import { processRoute } from '../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/recordings/[recordingId]/download'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { recordingId }) =>
      routes.recordings.download(request, recordingId),
);
