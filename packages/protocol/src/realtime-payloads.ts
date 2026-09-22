import { z } from 'zod';
import { idSchema } from './primitives';
import { parseTopic, type TopicFamily } from './topics';

// --- Outbox payloads ---------------------------------------------------

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
 * the doorbell fields (ADR 0032 §6). Notification content itself is
 * NOTIF-1's later epic; this is the envelope shape it will fill in.
 */
export const inboxDeltaPayloadSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('user.notification-delivered'),
  ids: z.array(idSchema).min(1).max(1),
  notificationType: z.string().trim().min(1).max(64),
  occurredAt: z.iso.datetime(),
});

/**
 * Revocations are outbox rows too (ADR 0032 §5), so every instance applies
 * them durably. They never ride a subscribed topic: `session.revoked`
 * closes the matching sockets directly, and `access.revoked` unsubscribes
 * the actor from the topic named in `ids`. They still need a schema so the
 * drain's generic row parse never meets a kind it cannot `safeParse`.
 */
export const sessionRevokedPayloadSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('session.revoked'),
  /** `[actorId]` or `[actorId, sessionId]`. */
  ids: z.array(idSchema).min(1).max(2),
});
export const accessRevokedPayloadSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('access.revoked'),
  /** Always exactly `[actorId, debateId]`: the actor to unsubscribe and the debate topic. */
  ids: z.array(idSchema).length(2),
});

/** The outbox payload contract, validated by `kind`, always carrying `version`. */
export const outboxPayloadSchema = z.union([
  doorbellPayloadSchema,
  inboxDeltaPayloadSchema,
  sessionRevokedPayloadSchema,
  accessRevokedPayloadSchema,
]);
export type OutboxPayload = z.infer<typeof outboxPayloadSchema>;
export type OutboxPayloadKind = OutboxPayload['kind'];

/**
 * Public families (`debate`, `debate:presence`, `standings`) carry doorbells
 * only, and each carries only its own kind — a `standings.updated` doorbell
 * on `debate:<id>:presence` is just as wrong as an inbox delta there.
 * `user:inbox` may carry its delta kind. `debate:chat` has no delivered kind
 * yet: chat delivery is CHAT-1's later epic (plan section I), so nothing may
 * ride that topic today. `session.revoked`/`access.revoked` are absent from
 * every list on purpose (see their schemas above): they are never delivered
 * as an `event` on a topic.
 */
export const topicFamilyPayloadKinds: Readonly<
  Record<TopicFamily, readonly OutboxPayloadKind[]>
> = {
  debate: ['debate.phase-changed'],
  'debate:presence': ['debate.presence-changed'],
  'debate:chat': [],
  'user:inbox': ['user.notification-delivered'],
  standings: ['standings.updated'],
};

/**
 * Validates an outbox payload against both its own shape and the topic it
 * would be delivered on: the payload must parse, and its `kind` must be
 * one this topic's family allows. This is what actually enforces the
 * doorbell-only and per-family constraints; the `event` message schema
 * calls it through a refinement so a mismatched pair fails `safeParse`
 * directly.
 */
export function isPayloadAllowedOnTopic(
  topic: string,
  payload: unknown,
): boolean {
  const parsedTopic = parseTopic(topic);
  if (!parsedTopic) return false;
  const parsedPayload = outboxPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) return false;
  return (
    topicFamilyPayloadKinds[parsedTopic.family] as readonly string[]
  ).includes(parsedPayload.data.kind);
}
