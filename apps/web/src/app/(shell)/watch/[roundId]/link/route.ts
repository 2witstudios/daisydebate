import { processRoute } from '../../../../../server/process-app';
import { audienceLinkComposition } from '../../../../../features/audience-link/composition';

type Params = Awaited<RouteContext<'/watch/[roundId]/link'>['params']>;

export const runtime = 'nodejs';

/** /watch/:roundId/link: opens an audience link, then moves to the clean Round page. */
export const GET = processRoute.withParams(
  audienceLinkComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.open(request, roundId),
);
