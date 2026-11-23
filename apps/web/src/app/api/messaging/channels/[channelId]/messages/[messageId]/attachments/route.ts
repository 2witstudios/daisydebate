import { processRoute } from '../../../../../../../../server/process-app';
import { messagingComposition } from '../../../../../../../../features/messaging/composition';
import { nativeFileResponse } from '../../../../../../../../features/messaging/files/form-response';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/messages/[messageId]/attachments'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  messagingComposition,
  (routes) =>
    (request, { channelId, messageId }: Params) => {
      return routes.files.attach(request, channelId, messageId, (state) =>
        nativeFileResponse(channelId, messageId, state),
      );
    },
);
