import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { idSchema, messagingChannelLifecycles } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingDmPairs,
  messagingGroupGrants,
} from '../schema/messaging-social';
import { contactPairs } from '../schema/contacts';

const positiveRevision = z.number().int().positive().safe();

/**
 * A private group's lifecycle: only DMs are ever retained (DEC-126), so a
 * retained group is refused as absent.
 */
export function groupLifecycleOf(
  lifecycle: (typeof messagingChannelLifecycles)[number],
): 'active' | 'archived' {
  if (lifecycle === 'retained') throw createAppError('NOT_FOUND');
  return lifecycle;
}
const base = {
  kind: z.literal('channel'),
  channelId: idSchema,
  policyRevision: positiveRevision,
  lifecycle: z.enum(messagingChannelLifecycles),
  revision: positiveRevision,
};
const dmAuthority = z
  .strictObject({
    kind: z.literal('dm'),
    lowActorId: idSchema,
    highActorId: idSchema,
    requestSenderActorId: idSchema,
    state: z.enum(['pending', 'accepted', 'declined', 'cancelled']),
    blocked: z.boolean(),
    revision: positiveRevision,
  })
  .refine(
    (pair) =>
      pair.lowActorId < pair.highActorId &&
      [pair.lowActorId, pair.highActorId].includes(pair.requestSenderActorId),
  );
const groupAuthority = z
  .strictObject({
    kind: z.literal('private_group'),
    actorId: idSchema,
    role: z.enum(['manager', 'member']).nullable(),
    generation: z.number().int().nonnegative().safe(),
    activeMemberActorIds: z.array(idSchema),
  })
  .refine(
    (grant) =>
      (grant.role === null || grant.generation > 0) &&
      new Set(grant.activeMemberActorIds).size ===
        grant.activeMemberActorIds.length &&
      (grant.role === null ||
        grant.activeMemberActorIds.includes(grant.actorId)),
  );
const channelFactSchema = z.union([
  z.strictObject({
    ...base,
    policyKey: z.literal('social.dm'),
    authority: dmAuthority,
  }),
  z.strictObject({
    ...base,
    policyKey: z.literal('social.private_group'),
    authority: groupAuthority,
  }),
]);
export type MessagingChannelFact = z.infer<typeof channelFactSchema>;
export type MessagingTransaction = Pick<BunSQLDatabase, 'execute'>;

/** Persistence validation, not an entitlement decision. Shared AZC evaluates it. */
export function parseMessagingChannelFact(
  input: unknown,
): MessagingChannelFact {
  const parsed = channelFactSchema.safeParse(input);
  if (!parsed.success)
    throw createAppError(
      'INFRASTRUCTURE',
      'Invalid messaging authority projection',
    );
  return parsed.data;
}

export function canonicalContactPair(first: string, second: string) {
  const ids = [idSchema.parse(first), idSchema.parse(second)].sort();
  if (ids[0] === ids[1])
    throw createAppError('VALIDATION', 'Self contact is not permitted');
  return { lowActorId: ids[0]!, highActorId: ids[1]! };
}

/** One channel's authority as `actor` sees it, over aliases c, d, p and g. */
const channelFactObject = (actor: SQL) => sql`jsonb_build_object(
      'kind', 'channel', 'channelId', c.id,
      'policyKey', c.policy_key, 'policyRevision', c.policy_revision,
      'lifecycle', c.lifecycle, 'revision', c.authority_revision,
      'authority', case when c.kind = 'dm' then jsonb_build_object(
        'kind', 'dm', 'lowActorId', d.low_actor_id, 'highActorId', d.high_actor_id,
        'requestSenderActorId', d.request_sender_actor_id, 'state', d.request_state,
        'blocked', p.low_blocks_high or p.high_blocks_low, 'revision', p.revision
      ) else jsonb_build_object(
        'kind', 'private_group', 'actorId', ${actor},
        'role', case when g.revoked_at is null then g.role else null end,
        'generation', coalesce(g.generation, 0),
        'activeMemberActorIds', coalesce((select jsonb_agg(actor_id order by actor_id)
          from ${messagingGroupGrants} where channel_id = c.id and revoked_at is null), '[]'::jsonb)
      ) end
    )`;
const channelFactJoins = (actor: SQL) => sql`
    left join ${messagingDmPairs} d on d.channel_id = c.id
    left join ${contactPairs} p on p.low_actor_id = d.low_actor_id and p.high_actor_id = d.high_actor_id
    left join ${messagingGroupGrants} g on g.channel_id = c.id and g.actor_id = ${actor}`;

/**
 * Reads through the caller's SAME transaction. A mutation first locks current
 * account rows, then contact pair, then channel; it evaluates this projection
 * after all waits. Read callers must compose current account/policy authority.
 * No preference, cached age or friendship assertion is projected here.
 */
export async function readMessagingChannelFact(
  tx: MessagingTransaction,
  channelId: string,
  actorId: string,
): Promise<MessagingChannelFact | null> {
  idSchema.parse(channelId);
  idSchema.parse(actorId);
  const actor = sql`${actorId}::text`;
  const rows = (await tx.execute(sql`
    select ${channelFactObject(actor)} as fact
    from ${messagingChannels} c ${channelFactJoins(actor)}
    where c.id = ${channelId} and (c.kind <> 'dm' or d.channel_id is not null)
  `)) as unknown as Array<{ fact: unknown }>;
  return rows.length === 0 ? null : parseMessagingChannelFact(rows[0]!.fact);
}

/**
 * Each binding's channel as its actor sees it, in one statement and in
 * binding order; an absent channel is null at its index.
 */
export async function readMessagingChannelFacts(
  tx: MessagingTransaction,
  bindings: readonly { readonly channelId: string; readonly actorId: string }[],
): Promise<readonly (MessagingChannelFact | null)[]> {
  if (bindings.length === 0) return [];
  const wanted = bindings.map((binding, index) => ({
    i: index,
    channel_id: idSchema.parse(binding.channelId),
    actor_id: idSchema.parse(binding.actorId),
  }));
  const actor = sql`w.actor_id`;
  const rows = (await tx.execute(sql`
    select w.i as "index", ${channelFactObject(actor)} as fact
    from jsonb_to_recordset(${JSON.stringify(wanted)}::text::jsonb) as w(i integer, channel_id text, actor_id text)
    join ${messagingChannels} c on c.id = w.channel_id ${channelFactJoins(actor)}
    where c.kind <> 'dm' or d.channel_id is not null
  `)) as unknown as Array<{ index: unknown; fact: unknown }>;
  const facts: (MessagingChannelFact | null)[] = bindings.map(() => null);
  for (const row of rows) {
    const index = Number(row.index);
    if (!Number.isSafeInteger(index) || facts[index] !== null)
      throw createAppError('INFRASTRUCTURE');
    facts[index] = parseMessagingChannelFact(row.fact);
  }
  return facts;
}
