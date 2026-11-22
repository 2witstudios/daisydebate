import { tryInstantMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { createMessagingFileSchemas } from '@daisy/protocol/messaging/files';
import { idSchema } from '@daisy/protocol/primitives';
import type { FilePolicy, FileReserveCommand } from './records';

export function requireReservation(
  command: FileReserveCommand,
  channelId: string,
  now: string,
  policy: FilePolicy,
): void {
  const valid = createMessagingFileSchemas(policy).reserve.safeParse({
    version: 1,
    channelId,
    requestId: command.requestId,
    filename: command.filename,
    mime: command.mime,
    bytes: command.bytes,
  });
  if (
    !valid.success ||
    !idSchema.safeParse(command.id).success ||
    !idSchema.safeParse(command.objectKey).success ||
    tryInstantMs(now) === undefined
  )
    throw createAppError('VALIDATION');
}
