import { z } from 'zod';
import { idSchema, errorSchema, debateRoles } from './primitives';
import { topicStringSchema, parseTopic, type TopicFamily } from './topics';
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
  actorPresencePreferenceChangedPayloadSchema,
  outboxPayloadSchema,
  topicFamilyPayloadKinds,
  storageFamilyPayloadKinds,
  isPayloadAllowedOnTopic,
  isPayloadStorableOnTopic,
} from './realtime-payloads';
export type {
  DoorbellKind,
  OutboxPayload,
  OutboxPayloadKind,
} from './realtime-payloads';

/**
 * Nominal branding (a phantom marker, erased at runtime) so
 * `ENVELOPE_VERSION` and `PROTOCOL_VERSION` cannot be validated against each
 * other by a future edit: assigning one where the other is expected, or
 * defining one in terms of the other, is a type error caught by
 * `bun typecheck`, even though both equal `1` today. A plain shared `number`
 * literal cannot make that distinction, since the values coincide.
 */
type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };
export type EnvelopeVersion = Brand<number, 'EnvelopeVersion'>;
export type ProtocolVersion = Brand<number, 'ProtocolVersion'>;

/**
 * The message-envelope version, stamped on `v` in every client and server
 * message. It versions the wire framing (the envelope shape itself), not
 * the message set `hello` negotiates (ADR 0031 §6): the two are distinct
 * values that happen to both start at `1`, tracked by separate branded
 * constants so one can change without forcing the other. An unsupported `v`
 * closes the socket with `protocol_unsupported` rather than being silently
 * dropped, unlike PageSpace's socket.io events.
 */
export const ENVELOPE_VERSION: EnvelopeVersion = 1 as EnvelopeVersion;

/**
 * The application protocol version `hello.protocolVersion` negotiates: the
 * client and server message set and semantics. See `ENVELOPE_VERSION` for
 * why this is a separate branded constant rather than the same literal
 * reused.
 */
export const PROTOCOL_VERSION: ProtocolVersion = 1 as ProtocolVersion;

/**
 * Typed literal builders: each accepts only its own branded version type, so
 * `PROTOCOL_VERSION` declared as `= ENVELOPE_VERSION` (RT-2.1c AC1's mutation
 * M3b) is a type error caught by `bun typecheck`, not merely a coincidence
 * that both constants are `1`. They do not by themselves stop a mutation
 * that hard-codes a literal `z.literal(ENVELOPE_VERSION)` into the `hello`
 * schema's `protocolVersion` field (M3a as worded): that mutation bypasses
 * these builders entirely, so it is `buildHelloMessageSchema` below, tested
 * with distinct injected versions, that catches it.
 */
function envelopeVersionLiteral(
  version: EnvelopeVersion,
): z.ZodLiteral<EnvelopeVersion> {
  return z.literal(version);
}
function protocolVersionLiteral(
  version: ProtocolVersion,
): z.ZodLiteral<ProtocolVersion> {
  return z.literal(version);
}

/** The envelope shape `{v}`, built from an injected envelope version. */
function buildEnvelope(envelopeVersion: EnvelopeVersion): {
  readonly v: z.ZodLiteral<EnvelopeVersion>;
} {
  return { v: envelopeVersionLiteral(envelopeVersion) } as const;
}

/**
 * The `hello` message schema, built from independently injected envelope and
 * protocol versions (RT-2.1c AC1). Production wires it with the two real
 * constants below; `realtime-messages.test.ts` wires it with two distinct
 * values so a mutation that hard-codes either field to the other's version,
 * or to a module-level constant instead of its own parameter, turns the
 * composed schema — not just the isolated literal builders — red.
 */
export function buildHelloMessageSchema(
  envelopeVersion: EnvelopeVersion,
  protocolVersion: ProtocolVersion,
) {
  return z.strictObject({
    ...buildEnvelope(envelopeVersion),
    type: z.literal('hello'),
    protocolVersion: protocolVersionLiteral(protocolVersion),
    ticket: ticketSchema,
  });
}

/**
 * Heartbeat, reconnect and backpressure constants `@daisy/protocol` owns
 * (ADR 0031 §7, §9; ADR 0033 §6). `heartbeatMs` and `reconnectBudgetMs` are
 * also consumed as engine rules-validation inputs
 * (`debate.rules.check-in-grace-covers-reconnect`, ADR 0033 §6); the socket
 * and backpressure bounds are consumed by `apps/realtime`.
 */
export const heartbeatMs = 15_000;
export const reconnectBudgetMs = 10_000;
/** Bun `idleTimeout` seconds (not milliseconds): reaps a silent peer. */
export const idleTimeout = 36;
export const backpressureBounds = {
  /** `backpressureLimit` + `closeOnBackpressureLimit`: the hard backstop. */
  hardBytes: 1_048_576,
  /** Above this, the server closes with `4005 slow_consumer`. */
  softBytes: 262_144,
} as const;

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
 * A single-use realtime connect ticket (ADR 0031 §11): 32 CSPRNG bytes,
 * base64url-encoded, so exactly 43 characters and never padded. It is a
 * bearer secret, so it is never a cuid2 and is never logged.
 */
export const ticketSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// --- Subscribe authorization table (data, no I/O) ---------------------

/**
 * Who may subscribe to each topic family, as data (ADR 0031 §5, plan
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

const envelope = buildEnvelope(ENVELOPE_VERSION);
const presenceActivitySchema = z.enum(['active', 'idle']);
/**
 * The projected presence status vocabulary. It lost its only in-package
 * consumer when `presence.update` was removed (RT-2.1b): RT-3.2a's HTTP
 * refetch of a `debate:<id>:presence` topic's projected value, triggered by
 * the `presence.changed` doorbell, is this schema's owner.
 */
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
  buildHelloMessageSchema(ENVELOPE_VERSION, PROTOCOL_VERSION),
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
 * Server-initiated messages (ADR 0031 §6): `ready` after a successful
 * `hello`, `revoked` on `session.revoked` or a failed revalidation, and
 * `server.restarting` on SIGTERM drain. None carries a request `id`.
 */
const serverInitiatedTypes = ['ready', 'revoked', 'server.restarting'] as const;

/**
 * The presence doorbell (ADR 0033 §1): fired when a `debate:presence`
 * topic's projected value changes. It carries no outbox `position` and no
 * status, unlike `event`: presence is never written to the outbox, so
 * there is no position to carry, and the client always refetches the
 * projected value over HTTP rather than trusting a pushed status.
 */
const presenceChangedMessageSchema = z
  .strictObject({
    ...envelope,
    type: z.literal('presence.changed'),
    topic: topicStringSchema,
  })
  .refine(
    (message) => parseTopic(message.topic)?.family === 'debate:presence',
    {
      message: 'presence.changed must name a debate:presence topic',
      path: ['topic'],
    },
  );

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
  presenceChangedMessageSchema,
  z.strictObject({
    ...envelope,
    type: z.enum(serverInitiatedTypes),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
