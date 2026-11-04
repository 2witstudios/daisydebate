import { realtimePublicUrlSchema } from '@daisy/config';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { createMessagingInboxSchemas } from '@daisy/protocol';
export async function readMessagingInboxResponse(response: Response) {
  if (!response.ok) return null;
  // jitless: the browser's strict CSP refuses Zod's eval-compiled parser.
  const limit = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .safeParse(response.headers.get('x-messaging-page-items'), {
      jitless: true,
    });
  if (!limit.success) throw createAppError('INFRASTRUCTURE');
  const result = createMessagingInboxSchemas(limit.data).result.safeParse(
    await response.json(),
    { jitless: true },
  );
  if (!result.success) throw createAppError('INFRASTRUCTURE');
  const endpoint = response.headers.get('x-realtime-socket-url');
  return {
    ...result.data,
    socketUrl:
      endpoint === null ? null : realtimePublicUrlSchema.parse(endpoint),
  };
}
