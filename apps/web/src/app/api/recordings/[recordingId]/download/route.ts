import { processRouteWithParams } from '../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/recordings/[recordingId]/download'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { recordingId }) =>
      routes.recordings.download(request, recordingId),
);
