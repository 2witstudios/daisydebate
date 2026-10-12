import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingContactPairs,
  messagingDmPairs,
  messagingGroupGrants,
} from '../schema/messaging-social';

const positiveRevision = z.number().int().positive().safe();
const base = {
  kind: z.literal('channel'),
  channelId: idSchema,
  policyRevision: positiveRevision,
  lifecycle: z.enum(['active', 'archived']),
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
  const rows = await queryMessagingChannelFacts(tx, [{ channelId, actorId }]);
  return rows[0] ? parseMessagingChannelFact(rows[0].fact) : null;
}
/** One bounded source cast per channel, reused across principals; overflow is never truncated policy. */
async function queryMessagingChannelFacts(
  tx: MessagingTransaction,
  bindings: readonly { channelId: string; actorId: string }[],
) {
  if (
    bindings.length < 1 ||
    bindings.length > 256 ||
    bindings.some(
      (b) =>
        !idSchema.safeParse(b.channelId).success ||
        !idSchema.safeParse(b.actorId).success,
    )
  )
    throw createAppError('VALIDATION');
  const rows = await tx.execute(sql`
    with requested as materialized (select distinct * from jsonb_to_recordset(${JSON.stringify(bindings)}::text::jsonb) as b("channelId" text,"actorId" text)),
    selected as materialized (select c.id,c.kind,c.policy_key,c.policy_revision,c.lifecycle,c.authority_revision from ${messagingChannels} c where c.id in(select "channelId" from requested)),
    cast_rows as materialized (select g.channel_id,g.actor_id from ${messagingGroupGrants} g join selected c on c.id=g.channel_id and c.kind='private_group' where g.revoked_at is null order by g.channel_id,g.actor_id limit 4097),
    casts as materialized (select channel_id,jsonb_agg(actor_id order by actor_id) actors from cast_rows group by channel_id)
    select requested."channelId",requested."actorId",(select count(*)::int from cast_rows) as "castFacts",jsonb_build_object(
      'kind', 'channel', 'channelId', c.id,
      'policyKey', c.policy_key, 'policyRevision', c.policy_revision,
      'lifecycle', c.lifecycle, 'revision', c.authority_revision,
      'authority', case when c.kind = 'dm' then jsonb_build_object(
        'kind', 'dm', 'lowActorId', d.low_actor_id, 'highActorId', d.high_actor_id,
        'requestSenderActorId', d.request_sender_actor_id, 'state', d.request_state,
        'blocked', p.low_blocks_high or p.high_blocks_low, 'revision', p.revision
      ) else jsonb_build_object(
        'kind', 'private_group', 'actorId', requested."actorId",
        'role', case when g.revoked_at is null then g.role else null end,
        'generation', coalesce(g.generation, 0),
        'activeMemberActorIds', coalesce(casts.actors, '[]'::jsonb)
      ) end
    ) as fact
    from requested join selected c on c.id=requested."channelId"
    left join ${messagingDmPairs} d on d.channel_id = c.id
    left join ${messagingContactPairs} p on p.low_actor_id = d.low_actor_id and p.high_actor_id = d.high_actor_id
    left join ${messagingGroupGrants} g on g.channel_id = c.id and g.actor_id = requested."actorId"
    left join casts on casts.channel_id=c.id
    where c.kind <> 'dm' or d.channel_id is not null
  `);
  if (rows.some((row) => Number(row.castFacts) > 4096))
    throw createAppError(
      'INFRASTRUCTURE',
      'Authority fact capacity unavailable',
    );
  return rows;
}

export async function readMessagingChannelFacts(
  tx: MessagingTransaction,
  bindings: readonly { channelId: string; actorId: string }[],
): Promise<readonly (MessagingChannelFact | null)[]> {
  const rows = await queryMessagingChannelFacts(tx, bindings);
  const byBinding = new Map(
    rows.map((row) => [
      `${row.channelId}:${row.actorId}`,
      parseMessagingChannelFact(row.fact),
    ]),
  );
  return bindings.map(
    (b) => byBinding.get(`${b.channelId}:${b.actorId}`) ?? null,
  );
}
