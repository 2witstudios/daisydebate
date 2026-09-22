import { z } from 'zod';
import { idSchema, errorSchema, debateRoles } from './primitives';
import { topicStringSchema, type TopicFamily } from './topics';
import {
  outboxPayloadSchema,
  isPayloadAllowedOnTopic,
} from './realtime-payloads';

/**
 * Explicit re-exports, not `export *` (AGENTS.md: explicit exports, no
 * barrels). `@daisy/protocol` still has one public entry, `./src/index.ts`,
 * which re-exports this module; these three named blocks are what make
 * every symbol from `topics.ts`, `close-codes.ts` and `realtime-payloads.ts`
 * reachable from it, listed by name rather than by wildcard.
 */
export {
  seasonIdSchema,
  parseTopic,
  topicStringSchema,
  buildDebateTopic,
  buildDebatePresenceTopic,
  buildDebateChatTopic,
  buildUserInboxTopic,
  buildStandingsTopic,
} from './topics';
export type { TopicFamily, ParsedTopic } from './topics';

export { closeCodeTable } from './close-codes';
export type { CloseCodeReason } from './close-codes';

export {
  doorbellKinds,
  doorbellKindSchema,
  doorbellPayloadSchema,
  inboxDeltaPayloadSchema,
  sessionRevokedPayloadSchema,
  accessRevokedPayloadSchema,
  outboxPayloadSchema,
  topicFamilyPayloadKinds,
  isPayloadAllowedOnTopic,
} from './realtime-payloads';
export type {
  DoorbellKind,
  OutboxPayload,
  OutboxPayloadKind,
} from './realtime-payloads';

/**
 * The wire protocol version. It is both the message-envelope `v` (every
 * client and server message is stamped with it) and the value `hello`
 * negotiates: an unsupported version closes the socket with
 * `protocol_unsupported` (ADR 0031 §5) rather than being silently dropped,
 * unlike PageSpace's socket.io events.
 */
export const PROTOCOL_VERSION = 1;

/**
 * An opaque `(txid, seq)` outbox position, serialized as `txid:seq`
 * (see the plan's cursor-correctness section). It is an ordering token, not
 * a secret, but its shape is still validated on every use. Each part is
 * bounded to 1-20 digits: `txid` is `xid8` (PostgreSQL's 64-bit transaction
 * id) and `seq` is `bigserial` (a signed 64-bit sequence); 20 digits covers
 * `xid8`'s full unsigned range, with no leading zero except the value `0`
 * itself.
 */
export const cursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,19}):(0|[1-9]\d{0,19})$/);

/**
 * A single-use realtime connect ticket (ADR 0031 §10): 32 CSPRNG bytes,
 * base64url-encoded, so exactly 43 characters and never padded. It is a
 * bearer secret, so it is never a cuid2 and is never logged.
 */
export const ticketSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// --- Subscribe authorization table (data, no I/O) ---------------------

/**
 * Who may subscribe to each topic family, as data (ADR 0031 §10, plan
 * section D's registry table). RT-2.5a's subscribe registry consumes this;
 * it performs no authorization itself. A family absent from this table is
 * refused. `privateRoles` is the ADR 0029 seat-role vocabulary itself
 * (`debateRoles`): every seated role is admitted when the debate is
 * private, so there is nothing to subset.
 */
export type SubscribeAuthorizationRule =
  | {
      readonly kind: 'public-or-private-participant';
      readonly privateRoles: typeof debateRoles;
      readonly admitsInvitedSpectators: true;
    }
  | {
      readonly kind: 'chat-participant-or-public-member';
      readonly privateRoles: typeof debateRoles;
    }
  | { readonly kind: 'owner-only' }
  | { readonly kind: 'any-member' };

export const subscribeAuthorizationTable: Readonly<
  Record<TopicFamily, SubscribeAuthorizationRule>
> = {
  /** Any signed-in member when public; every seated role and invited spectators when private. */
  debate: {
    kind: 'public-or-private-participant',
    privateRoles: debateRoles,
    admitsInvitedSpectators: true,
  },
  'debate:presence': {
    kind: 'public-or-private-participant',
    privateRoles: debateRoles,
    admitsInvitedSpectators: true,
  },
  /** Every seated role always; signed-in members too, when public. */
  'debate:chat': {
    kind: 'chat-participant-or-public-member',
    privateRoles: debateRoles,
  },
  /** The owner only, matched against the ticket's actorId. */
  'user:inbox': { kind: 'owner-only' },
  /** Any signed-in member. */
  standings: { kind: 'any-member' },
};

// --- Client and server message envelopes -------------------------------

const envelope = { v: z.literal(PROTOCOL_VERSION) };
const presenceActivitySchema = z.enum(['active', 'idle']);
export const presenceStatusSchema = z.enum([
  'in-debate',
  'online',
  'away',
  'offline',
]);

/**
 * The socket accepts exactly these five inbound types (ADR 0031 §4).
 * Commands go over HTTP to `apps/web`; adding a command message here would
 * reopen the attack surface the plan deliberately closed. `id` is present
 * only on messages that expect a reply keyed by that same `id`: `subscribe`,
 * `unsubscribe` and `ping`.
 */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('hello'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ticket: ticketSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('subscribe'),
    id: idSchema,
    topic: topicStringSchema,
    since: cursorSchema.optional(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('unsubscribe'),
    id: idSchema,
    topic: topicStringSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('presence.activity'),
    activity: presenceActivitySchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('ping'),
    id: idSchema,
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/**
 * Server-initiated messages (ADR 0031 §5): `ready` after a successful
 * `hello`, `revoked` on `session.revoked` or a failed revalidation, and
 * `server.restarting` on SIGTERM drain. None carries a request `id`.
 */
const serverInitiatedTypes = ['ready', 'revoked', 'server.restarting'] as const;

/**
 * The event message pairs an outbox position with its payload. Its
 * refinement is what enforces AC4: a payload whose `kind` the topic's
 * family does not allow fails `safeParse` here, not somewhere downstream.
 */
const eventMessageSchema = z
  .strictObject({
    ...envelope,
    type: z.literal('event'),
    topic: topicStringSchema,
    position: cursorSchema,
    payload: outboxPayloadSchema,
  })
  .refine(
    (message) => isPayloadAllowedOnTopic(message.topic, message.payload),
    {
      message: 'Payload kind is not allowed on this topic family',
      path: ['payload', 'kind'],
    },
  );

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('subscribed'),
    id: idSchema,
    topic: topicStringSchema,
    position: cursorSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('unsubscribed'),
    id: idSchema,
    topic: topicStringSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('resync_required'),
    id: idSchema,
    topic: topicStringSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('error'),
    id: idSchema.optional(),
    code: errorSchema.shape.code,
    message: z.string(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('pong'),
    id: idSchema,
  }),
  eventMessageSchema,
  z.strictObject({
    ...envelope,
    type: z.literal('presence.update'),
    topic: topicStringSchema,
    actorId: idSchema,
    status: presenceStatusSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.enum(serverInitiatedTypes),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
