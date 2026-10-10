import { z } from 'zod';
import { createMessagingFileSchemas } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
/** Transport bounds describe the injected validator, never authority or activation. */
export function messagingFileResponseSchemas(response: Response) {
  const positive = z.coerce.number().int().positive().safe();
  const parsed = z
    .object({ maxFileBytes: positive, maxFilenameUnits: positive })
    .safeParse({
      maxFileBytes: response.headers.get('x-messaging-file-bytes'),
      maxFilenameUnits: response.headers.get('x-messaging-filename-units'),
    });
  if (!parsed.success) throw createAppError('INFRASTRUCTURE');
  return createMessagingFileSchemas(parsed.data);
}
