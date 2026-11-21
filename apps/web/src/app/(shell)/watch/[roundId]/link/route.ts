import { processRoute } from '../../../../../server/process-app';

type Params = Awaited<RouteContext<'/watch/[roundId]/link'>['params']>;

export const runtime = 'nodejs';

/** /watch/:roundId/link: opens an audience link, then moves to the clean Round page. */
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.audienceLink.open(request, roundId),
);
