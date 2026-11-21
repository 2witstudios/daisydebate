import { processRouteWithParams } from '../../../../../../../../server/process-app';
import { nativeFileResponse } from '../../../../../../../../features/messaging/files/form-response';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/messages/[messageId]/attachments'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { channelId, messageId }) => {
      return routes.messaging.files.attach(
        request,
        channelId,
        messageId,
        (state) => nativeFileResponse(channelId, messageId, state),
      );
    },
);
