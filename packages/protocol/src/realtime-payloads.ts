import { z } from 'zod';
import { idSchema } from './primitives';
import { parseTopic, type TopicFamily } from './topics';

// --- Outbox payloads ---------------------------------------------------

/**
 * `entityVersion` is the version of the entity the row announces (ADR 0032
 * §1), never a schema version: schema versions are `version` or `v`
 * elsewhere in the protocol, so the name alone says which it is. It only
 * ever increases, so it is a positive integer, never the literal `1`.
 */
const entityVersionSchema = z.int().positive();

/**
 * `debate.presence-changed` is not one of these: presence is never written
 * to the outbox (ADR 0033 §1). It is delivered as the `presence.changed`
 * server message instead, which carries no outbox position or kind.
 */
const doorbellKinds = ['debate.phase-changed', 'standings.updated'] as const;
const doorbellKindSchema = z.enum(doorbellKinds);

/** The doorbell shape: nothing beyond ids, kind and entity version. */
const doorbellPayloadSchema = z.strictObject({
  entityVersion: entityVersionSchema,
  kind: doorbellKindSchema,
  ids: z.array(idSchema).min(1).max(8),
});

/**
 * Only the owner-only `user:inbox` family may carry a small delta beyond
 * the doorbell fields (ADR 0032 §6). Notification content itself is
 * NOTIF-1's later epic; this is the envelope shape it will fill in.
 */
const inboxDeltaPayloadSchema = z.strictObject({
  entityVersion: entityVersionSchema,
  kind: z.literal('user.notification-delivered'),
  ids: z.array(idSchema).min(1).max(1),
  notificationType: z.string().trim().min(1).max(64),
  occurredAt: z.iso.datetime(),
});

/**
 * Revocations are outbox rows too (ADR 0032 §5), so every instance applies
 * them durably. They ride the actor's own `user:<actorId>:inbox` topic as
 * control rows (plan revision 4.11, ADR 0032 §6): storable there, but never
 * delivered as an `event` message. `session.revoked` closes the matching
 * sockets directly, and `access.revoked` unsubscribes the actor from the
 * topic named in `ids`; realtime consumes both straight from the drain.
 */
const sessionRevokedPayloadSchema = z.strictObject({
  entityVersion: entityVersionSchema,
  kind: z.literal('session.revoked'),
  /** `[actorId]` or `[actorId, sessionId]`. */
  ids: z.array(idSchema).min(1).max(2),
});
const accessRevokedPayloadSchema = z.strictObject({
  entityVersion: entityVersionSchema,
  kind: z.literal('access.revoked'),
  /** Always exactly `[actorId, debateId]`: the actor to unsubscribe and the debate topic. */
  ids: z.array(idSchema).length(2),
});

/**
 * A visibility-preference change (RT-3.2b, plan revision 4.11): appended in
 * the settings transaction on the actor's own inbox as a control row.
 * Realtime consumes it to re-project that actor's presence locally and
 * ring `presence.changed`; presence state itself is still never written to
 * the outbox (ADR 0033 §1). It never rides a subscribed topic as an
 * `event`, exactly like the two revocation kinds above.
 */
const actorPresencePreferenceChangedPayloadSchema = z.strictObject({
  entityVersion: entityVersionSchema,
  kind: z.literal('actor.presence-preference-changed'),
  /** `[actorId]`. */
  ids: z.array(idSchema).length(1),
});

/** The outbox payload contract, discriminated by `kind`, always carrying `entityVersion`. */
export const outboxPayloadSchema = z.discriminatedUnion('kind', [
  doorbellPayloadSchema,
  inboxDeltaPayloadSchema,
  sessionRevokedPayloadSchema,
  accessRevokedPayloadSchema,
  actorPresencePreferenceChangedPayloadSchema,
]);
type OutboxPayload = z.infer<typeof outboxPayloadSchema>;
type OutboxPayloadKind = OutboxPayload['kind'];

/**
 * Which kinds an outbox row may carry on each topic family. Public families
 * (`debate`, `standings`) carry only their own doorbell. `debate:presence`
 * and `debate:chat` carry nothing: presence is never written to the outbox
 * (ADR 0033 §1) and chat delivery is CHAT-1's later epic. The owner-only
 * `user:inbox` carries its delta plus the three control kinds realtime
 * consumes from the drain and never forwards to a client (plan revision
 * 4.11). `@daisy/db`'s append validates each row against this rule.
 */
const storageFamilyPayloadKinds: Readonly<
  Record<TopicFamily, readonly OutboxPayloadKind[]>
> = {
  debate: ['debate.phase-changed'],
  'debate:presence': [],
  'debate:chat': [],
  'user:inbox': [
    'user.notification-delivered',
    'session.revoked',
    'access.revoked',
    'actor.presence-preference-changed',
  ],
  standings: ['standings.updated'],
};

/**
 * Validates an outbox payload against both its own shape and the topic it
 * would be stored on: the payload must parse, and its `kind` must be one
 * this topic's family may carry. `@daisy/db`'s append calls this before
 * insert.
 */
export function isPayloadStorableOnTopic(
  topic: string,
  payload: unknown,
): boolean {
  const parsedTopic = parseTopic(topic);
  if (!parsedTopic) return false;
  const parsedPayload = outboxPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) return false;
  return storageFamilyPayloadKinds[parsedTopic.family].includes(
    parsedPayload.data.kind,
  );
}
