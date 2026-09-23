import { z } from 'zod';
import { idSchema } from './primitives';
import { parseTopic, type TopicFamily } from './topics';

// --- Outbox payloads ---------------------------------------------------

/**
 * The entity version an outbox row's `version` column carries (ADR 0032 §1):
 * the version of the entity the row announces, not a payload-schema
 * version. It only ever increases, so it is a positive integer, never the
 * literal `1`.
 */
const entityVersionSchema = z.int().positive();

/**
 * `debate.presence-changed` is not one of these: presence is never written
 * to the outbox (ADR 0033 §1). It is delivered as the `presence.changed`
 * server message instead, which carries no outbox position or kind.
 */
export const doorbellKinds = [
  'debate.phase-changed',
  'standings.updated',
] as const;
export type DoorbellKind = (typeof doorbellKinds)[number];
export const doorbellKindSchema = z.enum(doorbellKinds);

/** The doorbell shape: nothing beyond ids, kind and version. */
export const doorbellPayloadSchema = z.strictObject({
  version: entityVersionSchema,
  kind: doorbellKindSchema,
  ids: z.array(idSchema).min(1).max(8),
});

/**
 * Only the owner-only `user:inbox` family may carry a small delta beyond
 * the doorbell fields (ADR 0032 §6). Notification content itself is
 * NOTIF-1's later epic; this is the envelope shape it will fill in.
 */
export const inboxDeltaPayloadSchema = z.strictObject({
  version: entityVersionSchema,
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
export const sessionRevokedPayloadSchema = z.strictObject({
  version: entityVersionSchema,
  kind: z.literal('session.revoked'),
  /** `[actorId]` or `[actorId, sessionId]`. */
  ids: z.array(idSchema).min(1).max(2),
});
export const accessRevokedPayloadSchema = z.strictObject({
  version: entityVersionSchema,
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
export const actorPresencePreferenceChangedPayloadSchema = z.strictObject({
  version: entityVersionSchema,
  kind: z.literal('actor.presence-preference-changed'),
  /** `[actorId]`. */
  ids: z.array(idSchema).length(1),
});

/** The outbox payload contract, validated by `kind`, always carrying `version`. */
export const outboxPayloadSchema = z.union([
  doorbellPayloadSchema,
  inboxDeltaPayloadSchema,
  sessionRevokedPayloadSchema,
  accessRevokedPayloadSchema,
  actorPresencePreferenceChangedPayloadSchema,
]);
export type OutboxPayload = z.infer<typeof outboxPayloadSchema>;
export type OutboxPayloadKind = OutboxPayload['kind'];

/**
 * The **delivery-side** rule `isPayloadAllowedOnTopic` enforces for the
 * `event` message. Public families (`debate`, `standings`) carry doorbells
 * only, and each carries only its own kind — a `standings.updated` doorbell
 * on `debate:<id>` is just as wrong as an inbox delta there. `user:inbox`
 * may carry its delta kind. `debate:presence` and `debate:chat` carry no
 * outbox kind at all: presence is delivered as the `presence.changed`
 * server message, never through the outbox (ADR 0033 §1), and chat delivery
 * is CHAT-1's later epic (plan section I), so nothing may ride that topic
 * today. The three control kinds (`session.revoked`, `access.revoked`,
 * `actor.presence-preference-changed`) are absent from every list on
 * purpose: they are never delivered as an `event` on a topic, even though
 * `storageFamilyPayloadKinds` below allows them on `user:inbox`.
 */
export const topicFamilyPayloadKinds: Readonly<
  Record<TopicFamily, readonly OutboxPayloadKind[]>
> = {
  debate: ['debate.phase-changed'],
  'debate:presence': [],
  'debate:chat': [],
  'user:inbox': ['user.notification-delivered'],
  standings: ['standings.updated'],
};

/**
 * The **storage-side** rule (plan revision 4.11): which kinds an outbox row
 * may carry on each family, broader than the delivery-side rule above.
 * `@daisy/db`'s append validates a row against this rule before insert, so
 * the three control kinds are storable on `user:<actorId>:inbox` even
 * though `topicFamilyPayloadKinds` never allows them there — they ride the
 * inbox as durable rows realtime consumes and never forwards to any client.
 */
export const storageFamilyPayloadKinds: Readonly<
  Record<TopicFamily, readonly OutboxPayloadKind[]>
> = {
  ...topicFamilyPayloadKinds,
  'user:inbox': [
    ...topicFamilyPayloadKinds['user:inbox'],
    'session.revoked',
    'access.revoked',
    'actor.presence-preference-changed',
  ],
};

function isPayloadAllowedByRule(
  rule: Readonly<Record<TopicFamily, readonly OutboxPayloadKind[]>>,
  topic: string,
  payload: unknown,
): boolean {
  const parsedTopic = parseTopic(topic);
  if (!parsedTopic) return false;
  const parsedPayload = outboxPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) return false;
  return (rule[parsedTopic.family] as readonly string[]).includes(
    parsedPayload.data.kind,
  );
}

/**
 * Validates an outbox payload against both its own shape and the topic it
 * would be **delivered** on: the payload must parse, and its `kind` must be
 * one this topic's family allows for an `event`. This is what actually
 * enforces the doorbell-only and per-family constraints; the `event`
 * message schema calls it through a refinement so a mismatched pair fails
 * `safeParse` directly.
 */
export function isPayloadAllowedOnTopic(
  topic: string,
  payload: unknown,
): boolean {
  return isPayloadAllowedByRule(topicFamilyPayloadKinds, topic, payload);
}

/**
 * Validates an outbox payload against both its own shape and the topic it
 * would be **stored** on (plan revision 4.11): the payload must parse, and
 * its `kind` must be one this topic's family allows to be appended, which
 * for `user:inbox` includes the three control kinds `event` never delivers.
 * `@daisy/db`'s append calls this before insert.
 */
export function isPayloadStorableOnTopic(
  topic: string,
  payload: unknown,
): boolean {
  return isPayloadAllowedByRule(storageFamilyPayloadKinds, topic, payload);
}
