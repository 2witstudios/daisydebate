import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { createMessagingInboxSchemas } from '@daisy/protocol';
export async function readMessagingInboxResponse(response: Response) {
  if (!response.ok) return null;
  const limit = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .safeParse(response.headers.get('x-messaging-page-items'));
  if (!limit.success) throw createAppError('INFRASTRUCTURE');
  const result = createMessagingInboxSchemas(limit.data).result.safeParse(
    await response.json(),
  );
  if (!result.success) throw createAppError('INFRASTRUCTURE');
  return result.data;
}
