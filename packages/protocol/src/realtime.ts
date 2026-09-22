import { z } from 'zod';
import { idSchema, errorSchema } from './primitives';

/**
 * The wire protocol version. It is both the message-envelope `v` (every
 * client and server message is stamped with it) and the value `hello`
 * negotiates: an unsupported version closes the socket with
 * `protocol_unsupported` (ADR: realtime service) rather than being silently
 * dropped, unlike PageSpace's socket.io events.
 */
export const PROTOCOL_VERSION = 1;

/**
 * `standings:<season>` names a season slug, not an entity id, so it is not
 * cuid2. Same shape as `formatIdSchema` in ./index: lowercase, digits and
 * hyphens.
 */
export const seasonIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/**
 * An opaque `(txid, seq)` outbox position, serialized as `txid:seq`
 * (see the plan's cursor-correctness section). It is an ordering token, not
 * a secret, but its shape is still validated on every use.
 */
export const cursorSchema = z.string().regex(/^(0|[1-9]\d*):(0|[1-9]\d*)$/);

// --- Topic grammar --------------------------------------------------------

/**
 * The five topic families this epic delivers on. Every other string is
 * refused: by `parseTopic` at the trust boundary, and by
 * `subscribeAuthorizationTable` for anything not listed there.
 */
export type TopicFamily =
  'debate' | 'debate:presence' | 'debate:chat' | 'user:inbox' | 'standings';

export type ParsedTopic =
  | { readonly family: 'debate'; readonly debateId: string }
  | { readonly family: 'debate:presence'; readonly debateId: string }
  | { readonly family: 'debate:chat'; readonly debateId: string }
  | { readonly family: 'user:inbox'; readonly userId: string }
  | { readonly family: 'standings'; readonly season: string };

function parseDebateTopic(segments: string[]): ParsedTopic | undefined {
  if (segments.length < 2 || segments.length > 3) return undefined;
  const debateId = segments[1]!;
  if (!idSchema.safeParse(debateId).success) return undefined;
  if (segments.length === 2) return { family: 'debate', debateId };
  const suffix = segments[2]!;
  if (suffix === 'presence') return { family: 'debate:presence', debateId };
  if (suffix === 'chat') return { family: 'debate:chat', debateId };
  return undefined;
}

function parseUserTopic(segments: string[]): ParsedTopic | undefined {
  if (segments.length !== 3 || segments[2] !== 'inbox') return undefined;
  const userId = segments[1]!;
  return idSchema.safeParse(userId).success
    ? { family: 'user:inbox', userId }
    : undefined;
}

function parseStandingsTopic(segments: string[]): ParsedTopic | undefined {
  if (segments.length !== 2) return undefined;
  const season = segments[1]!;
  return seasonIdSchema.safeParse(season).success
    ? { family: 'standings', season }
    : undefined;
}

/**
 * Parses a topic string into its family and ids, validating every id
 * segment against cuid2 (and `standings`'s season slug). Returns `undefined`
 * for anything that is not one of the five known shapes exactly, including
 * extra segments or a missing/malformed id — parsing never normalizes or
 * repairs input (ADR 0023).
 */
export function parseTopic(topic: string): ParsedTopic | undefined {
  const segments = topic.split(':');
  switch (segments[0]) {
    case 'debate':
      return parseDebateTopic(segments);
    case 'user':
      return parseUserTopic(segments);
    case 'standings':
      return parseStandingsTopic(segments);
    default:
      return undefined;
  }
}

/** A topic string, validated through the shared parser, for message schemas. */
export const topicStringSchema = z
  .string()
  .refine((value) => parseTopic(value) !== undefined, {
    message: 'Not a valid realtime topic',
  });

/**
 * The only way topic strings are built. Every consumer in `apps/web` and
 * `apps/realtime` must call these instead of building the string by hand;
 * the drift-guard test enforces it. Each builder validates its id segment
 * and throws on a malformed one, so a bad topic is never constructed.
 */
export const buildDebateTopic = (debateId: string): string =>
  `debate:${idSchema.parse(debateId)}`;
export const buildDebatePresenceTopic = (debateId: string): string =>
  `debate:${idSchema.parse(debateId)}:presence`;
export const buildDebateChatTopic = (debateId: string): string =>
  `debate:${idSchema.parse(debateId)}:chat`;
export const buildUserInboxTopic = (userId: string): string =>
  `user:${idSchema.parse(userId)}:inbox`;
export const buildStandingsTopic = (season: string): string =>
  `standings:${seasonIdSchema.parse(season)}`;

// --- Close codes -----------------------------------------------------------

/**
 * The documented close-code taxonomy (plan section C): a small, fixed set
 * in the application range (4000-4999), each with a client reaction.
 */
export const closeCodeTable = [
  {
    code: 4001,
    reason: 'auth_failed',
    description:
      'hello was missing, invalid, late or named an already-consumed ticket; the client must fetch a fresh ticket.',
  },
  {
    code: 4002,
    reason: 'rate_limited',
    description:
      'the connection, actor or IP exceeded a rate limit; the client should back off.',
  },
  {
    code: 4003,
    reason: 'protocol_unsupported',
    description:
      'hello named a protocolVersion the server does not support; the client must upgrade.',
  },
  {
    code: 4004,
    reason: 'slow_consumer',
    description:
      'backpressure exceeded the bound; the client should reconnect and catch up from its cursor.',
  },
  {
    code: 4005,
    reason: 'server_restarting',
    description:
      'the instance is draining for deploy; the client should reconnect elsewhere with jitter.',
  },
  {
    code: 4006,
    reason: 'revoked',
    description:
      'the session or subscription access was revoked; the client must not silently retry.',
  },
] as const;
export type CloseCodeReason = (typeof closeCodeTable)[number]['reason'];

// --- Outbox payloads ---------------------------------------------------

/**
 * Public families (`debate`, `debate:presence`, `standings`) carry doorbells
 * only: ids, `kind` and `version`, never content — clients refetch over
 * HTTP, where permissions are enforced on every read (plan section B).
 */
export const publicDoorbellTopicFamilies: readonly TopicFamily[] = [
  'debate',
  'debate:presence',
  'standings',
];

export const doorbellKinds = [
  'debate.phase-changed',
  'debate.presence-changed',
  'standings.updated',
] as const;
export type DoorbellKind = (typeof doorbellKinds)[number];
export const doorbellKindSchema = z.enum(doorbellKinds);

/** The doorbell shape: nothing beyond ids, kind and version. */
export const doorbellPayloadSchema = z.strictObject({
  version: z.literal(1),
  kind: doorbellKindSchema,
  ids: z.array(idSchema).min(1).max(8),
});

/**
 * Only the owner-only `user:inbox` family may carry a small delta beyond
 * the doorbell fields (plan section B). Notification content itself is
 * NOTIF-1's later epic; this is the envelope shape it will fill in.
 */
export const inboxDeltaPayloadSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('user.notification-delivered'),
  ids: z.array(idSchema).min(1).max(1),
  notificationType: z.string().trim().min(1).max(64),
  occurredAt: z.iso.datetime(),
});

/** The outbox payload contract, validated by `kind`, always carrying `version`. */
export const outboxPayloadSchema = z.union([
  doorbellPayloadSchema,
  inboxDeltaPayloadSchema,
]);
export type OutboxPayload = z.infer<typeof outboxPayloadSchema>;

// --- Subscribe authorization table (data, no I/O) ---------------------

/**
 * Who may subscribe to each topic family, as data (plan section D's
 * registry table). RT-2.5a's subscribe registry consumes this; it performs
 * no authorization itself. A family absent from this table is refused.
 */
export type SubscribeAuthorizationRule =
  | { readonly kind: 'public-or-private-participant' }
  | { readonly kind: 'chat-participant-or-public-member' }
  | { readonly kind: 'owner-only' }
  | { readonly kind: 'any-member' };

export const subscribeAuthorizationTable: Readonly<
  Record<TopicFamily, SubscribeAuthorizationRule>
> = {
  /** Any signed-in member when public; seated participants, judges and invited spectators when private. */
  debate: { kind: 'public-or-private-participant' },
  'debate:presence': { kind: 'public-or-private-participant' },
  /** Seated participants and judges always; signed-in members too, when public. */
  'debate:chat': { kind: 'chat-participant-or-public-member' },
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
 * The socket accepts exactly these five inbound types. Commands go over
 * HTTP to `apps/web`; adding a command message here would reopen the
 * attack surface the plan deliberately closed.
 */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('hello'),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    ticket: z.string().min(1).max(512),
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
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

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
    type: z.literal('resync_required'),
    id: idSchema.optional(),
    topic: topicStringSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('error'),
    id: idSchema.optional(),
    code: errorSchema.shape.code,
    message: z.string(),
    requestId: z.string().max(128),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('pong'),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('delivered'),
    topic: topicStringSchema,
    position: cursorSchema,
    payload: outboxPayloadSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('presence.update'),
    topic: topicStringSchema,
    actorId: idSchema,
    status: presenceStatusSchema,
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
