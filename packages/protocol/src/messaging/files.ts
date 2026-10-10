import { z } from 'zod';
import { idSchema } from '../primitives';
const messagingFileMimeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]);
/** No numeric policy is activated by this portable contract. */
export function createMessagingFileSchemas(bounds: {
  readonly maxFileBytes: number;
  readonly maxFilenameUnits: number;
}) {
  const positive = z.number().int().positive().safe();
  positive.parse(bounds.maxFileBytes);
  positive.parse(bounds.maxFilenameUnits);
  const association = {
    version: z.literal(1),
    channelId: idSchema,
    fileId: idSchema,
    generation: positive,
  };
  return {
    tokenResult: z.strictObject({
      version: z.literal(1),
      fileId: idSchema,
      generation: positive,
    }),
    reservationResult: z.strictObject({
      version: z.literal(1),
      fileId: idSchema,
      generation: positive,
      filename: z.string().min(1).max(bounds.maxFilenameUnits),
      mime: messagingFileMimeSchema,
      bytes: positive.max(bounds.maxFileBytes),
      expiresAt: z.iso.datetime(),
    }),
    listResult: z.strictObject({
      version: z.literal(1),
      files: z.array(
        z.strictObject({
          fileId: idSchema,
          generation: positive,
          messageId: idSchema,
          filename: z.string().min(1).max(bounds.maxFilenameUnits),
          mime: messagingFileMimeSchema,
          bytes: positive.max(bounds.maxFileBytes),
        }),
      ),
    }),
    reserve: z.strictObject({
      version: z.literal(1),
      channelId: idSchema,
      requestId: idSchema,
      bytes: positive.max(bounds.maxFileBytes),
      mime: messagingFileMimeSchema,
      filename: z
        .string()
        .min(1)
        .max(bounds.maxFilenameUnits)
        .refine(
          (name) =>
            name.trim().length > 0 &&
            [...name].every(
              (c) =>
                c.charCodeAt(0) > 31 &&
                c.charCodeAt(0) !== 127 &&
                c !== '/' &&
                c !== '\\',
            ),
        ),
    }),
    finalize: z.strictObject({ ...association, messageId: idSchema }),
    access: z.strictObject(association),
    cancel: z.strictObject(association),
  };
}
