import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/media/reconcile'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.roundMedia.reconcile(request, roundId),
);
