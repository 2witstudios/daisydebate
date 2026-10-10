import { processRoute } from '../../../../../../../../server/process-app';
import { nativeFileResponse } from '../../../../../../../../features/messaging/files/form-response';
export const runtime = 'nodejs';
export const POST = processRoute((routes) => (request) => {
  const parts = new URL(request.url).pathname.split('/'),
    channelId = parts[4] ?? '',
    messageId = parts[6] ?? '';
  return routes.messaging.files.attach(request, channelId, messageId, (state) =>
    nativeFileResponse(channelId, messageId, state),
  );
});
