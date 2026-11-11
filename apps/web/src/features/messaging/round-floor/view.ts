import { z } from 'zod';
import {
  createMessagingCoreSchemas,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';

const metadataSchema = z.strictObject({
  version: z.literal(1),
  roundId: idSchema,
  channelId: idSchema,
  readOnly: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
});
export type FloorMetadata = z.infer<typeof metadataSchema>;
export const parseFloorMetadata = (
  value: unknown,
  roundId: string,
): FloorMetadata | null => {
  const result = metadataSchema.safeParse(value, { jitless: true });
  return result.success && result.data.roundId === roundId ? result.data : null;
};
export const parseFloorDiscovery = (value: unknown, roundId: string) => {
  const result = z
    .strictObject({
      version: z.literal(1),
      roundId: idSchema,
      channel: metadataSchema.nullable(),
    })
    .safeParse(value, { jitless: true });
  return result.success &&
    result.data.roundId === roundId &&
    (result.data.channel === null || result.data.channel.roundId === roundId)
    ? result.data
    : null;
};
const readMarkSchema = z.strictObject({
  version: z.literal(1),
  channelId: idSchema,
  // How far the marker may be believed is the floor model's to decide.
  sequence: z.number(),
});
/** The sequence the route says it marked read, for this channel alone. */
export const parseFloorReadMark = (
  value: unknown,
  channelId: string,
): number | null => {
  const result = readMarkSchema.safeParse(value, { jitless: true });
  return result.success && result.data.channelId === channelId
    ? result.data.sequence
    : null;
};
export async function readFloorResponse(
  response: Response,
  roundId: string,
  channelId: string,
) {
  if (!response.ok) return null;
  const bounds = z
    .strictObject({
      messageUnits: z.coerce
        .number()
        .int()
        .positive()
        .max(messagingBetaLimits.messageUnits),
      pageItems: z.coerce
        .number()
        .int()
        .positive()
        .max(messagingBetaLimits.pageItems),
    })
    .safeParse(
      {
        messageUnits: response.headers.get('x-messaging-message-units'),
        pageItems: response.headers.get('x-messaging-page-items'),
      },
      { jitless: true },
    );
  if (!bounds.success) return null;
  const parsed = z
    .strictObject({
      version: z.literal(1),
      roundId: idSchema,
      metadata: metadataSchema,
      history: createMessagingCoreSchemas(bounds.data).viewedHistoryResult,
      authors: z
        .array(
          z.strictObject({
            actorId: idSchema,
            label: z.string().min(1).max(200),
          }),
        )
        .max(100),
    })
    .safeParse(await response.json(), { jitless: true });
  if (
    !parsed.success ||
    parsed.data.roundId !== roundId ||
    parsed.data.metadata.roundId !== roundId ||
    parsed.data.metadata.channelId !== channelId ||
    parsed.data.history.channelId !== channelId
  )
    return null;
  const { viewer, ...history } = parsed.data.history;
  return {
    metadata: parsed.data.metadata,
    history,
    viewer,
    authors: parsed.data.authors,
    bounds: bounds.data,
  };
}
/** One protected read of a floor's messages, as the route answers it. */
export type FloorPageRead = NonNullable<
  Awaited<ReturnType<typeof readFloorResponse>>
>;
