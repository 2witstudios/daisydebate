import { z } from 'zod';
import {
  createMessagingCoreSchemas,
  idSchema,
  messagingBetaLimits,
} from '@daisy/protocol';
import type { ChatContext } from './chat-context';

const metadataFields = {
  channelId: idSchema,
  readOnly: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
};
type MetadataFields = z.infer<z.ZodObject<typeof metadataFields>>;
/** One chat's channel as its route describes it, with the owner it was asked for. */
export type ContextChatMetadata = MetadataFields & {
  readonly version: 1;
  readonly ownerId: string;
};
/** The context's wire names its owner under its own field; every other field is shared. */
const metadataSchema = (context: ChatContext) =>
  z.strictObject({
    version: z.literal(1),
    [context.ownerKey]: idSchema,
    ...metadataFields,
  });
const ownerOf = (context: ChatContext, value: object): unknown =>
  (value as Readonly<Record<string, unknown>>)[context.ownerKey];
const metadataOf = (
  context: ChatContext,
  value: object,
  ownerId: string,
): ContextChatMetadata | null => {
  const { channelId, readOnly, expiresAt } = value as MetadataFields;
  return ownerOf(context, value) === ownerId
    ? { version: 1, ownerId, channelId, readOnly, expiresAt }
    : null;
};
export const parseContextChatMetadata = (
  context: ChatContext,
  value: unknown,
  ownerId: string,
): ContextChatMetadata | null => {
  const result = metadataSchema(context).safeParse(value, { jitless: true });
  return result.success ? metadataOf(context, result.data, ownerId) : null;
};
export const parseContextChatDiscovery = (
  context: ChatContext,
  value: unknown,
  ownerId: string,
): { readonly channel: ContextChatMetadata | null } | null => {
  const result = z
    .strictObject({
      version: z.literal(1),
      [context.ownerKey]: idSchema,
      channel: metadataSchema(context).nullable(),
    })
    .safeParse(value, { jitless: true });
  if (!result.success || ownerOf(context, result.data) !== ownerId) return null;
  const found = (result.data as { readonly channel: object | null }).channel;
  if (found === null) return { channel: null };
  const channel = metadataOf(context, found, ownerId);
  return channel ? { channel } : null;
};
const readMarkSchema = z.strictObject({
  version: z.literal(1),
  channelId: idSchema,
  // How far the marker may be believed is the chat model's to decide.
  sequence: z.number(),
});
/** The sequence the route says it marked read, for this channel alone. */
export const parseContextChatReadMark = (
  value: unknown,
  channelId: string,
): number | null => {
  const result = readMarkSchema.safeParse(value, { jitless: true });
  return result.success && result.data.channelId === channelId
    ? result.data.sequence
    : null;
};
export async function readContextChatResponse(
  context: ChatContext,
  response: Response,
  ownerId: string,
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
  const body: unknown = await response.json();
  const parsed = z
    .looseObject({
      version: z.literal(1),
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
    .safeParse(body, { jitless: true });
  // The owner field is the context's own, so the envelope's exact keys are checked here.
  const envelope = z
    .strictObject({
      version: z.literal(1),
      [context.ownerKey]: idSchema,
      metadata: z.unknown(),
      history: z.unknown(),
      authors: z.unknown(),
    })
    .safeParse(body, { jitless: true });
  if (!parsed.success || !envelope.success) return null;
  const metadata = parseContextChatMetadata(
    context,
    (envelope.data as { readonly metadata?: unknown }).metadata,
    ownerId,
  );
  if (
    ownerOf(context, envelope.data) !== ownerId ||
    metadata === null ||
    metadata.channelId !== channelId ||
    parsed.data.history.channelId !== channelId
  )
    return null;
  const { viewer, ...history } = parsed.data.history;
  return {
    metadata,
    history,
    viewer,
    authors: parsed.data.authors,
    bounds: bounds.data,
  };
}
/** One protected read of a chat's messages, as the route answers it. */
export type ContextChatPageRead = NonNullable<
  Awaited<ReturnType<typeof readContextChatResponse>>
>;
