import { processRoute } from '../../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = (
  request: Request,
  context: { params: Promise<{ channelId: string }> },
) =>
  processRoute(
    (routes) => async (incoming) =>
      routes.messaging.preferences(
        incoming,
        'read',
        (await context.params).channelId,
      ),
  )(request);
