import { z } from 'zod';
import { idSchema } from '../primitives';
export const messagingFileMimeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]);
export type MessagingFileMime = z.infer<typeof messagingFileMimeSchema>;
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
          (name) => name.trim().length > 0 && !/[\x00-\x1f\x7f/\\]/u.test(name),
        ),
    }),
    finalize: z.strictObject({ ...association, messageId: idSchema }),
    access: z.strictObject(association),
    cancel: z.strictObject(association),
  };
}
