import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { readMessagingChannelFacts, type MessagingChannelFact } from './social';
import type { MessagingInboxInvitation } from './inbox-page-contracts';

type Tx = Pick<BunSQLDatabase, 'execute' | 'select'>;
export type InboxDiscovery = {
  readonly channels: ReadonlyMap<string, MessagingChannelFact>;
  readonly invitations: ReadonlyMap<string, MessagingInboxInvitation>;
  readonly actors: readonly string[];
  readonly pairs: readonly { readonly low: string; readonly high: string }[];
};
const invitationRow = z.object({
  channelId: idSchema,
  inviterActorId: idSchema,
  generation: z.coerce.number().int().positive().safe(),
});
async function pendingInvitations(
  tx: Tx,
  actorId: string,
  channelIds: readonly string[],
) {
  const rows = await tx.execute(sql`
    select channel_id as "channelId",invited_by_actor_id as "inviterActorId",generation
    from public.messaging_group_invitations
    where invitee_actor_id=${actorId} and state='pending'
      and channel_id in (select jsonb_array_elements_text(${JSON.stringify(channelIds)}::text::jsonb))
    order by channel_id`);
  return rows.map((row) => {
    const parsed = invitationRow.safeParse(row);
    if (!parsed.success) throw createAppError('INFRASTRUCTURE');
    return parsed.data;
  });
}
function invitationFact(
  actorId: string,
  row: z.infer<typeof invitationRow>,
  channel: MessagingChannelFact | null,
  inviter: MessagingChannelFact | null,
): MessagingInboxInvitation | null {
  if (
    channel?.authority.kind !== 'private_group' ||
    inviter?.authority.kind !== 'private_group'
  )
    return null;
  return {
    kind: 'group_invitation',
    channel: {
      channelId: channel.channelId,
      kind: 'private_group',
      policyKey: 'social.private_group',
      policyRevision: channel.policyRevision,
      revision: channel.revision,
      lifecycle: channel.lifecycle,
      activeMemberActorIds: channel.authority.activeMemberActorIds,
    },
    invitation: {
      channelId: row.channelId,
      inviterActorId: row.inviterActorId,
      inviteeActorId: actorId,
      generation: row.generation,
      state: 'pending',
    },
    inviterGrant: {
      actorId: row.inviterActorId,
      role: inviter.authority.role,
      generation: inviter.authority.generation,
    },
  };
}
const pairKey = (a: string, b: string) => (a < b ? [a, b] : [b, a]);
/** Dependencies an entry's own capability needs: a granted cast, a DM pair, or inviter/invitee only. */
function dependencies(
  actorId: string,
  channels: ReadonlyMap<string, MessagingChannelFact>,
  invitations: ReadonlyMap<string, MessagingInboxInvitation>,
) {
  const actors = new Set([actorId]);
  const pairs = new Map<string, { low: string; high: string }>();
  const pair = (a: string, b: string) => {
    const [low, high] = pairKey(a, b) as [string, string];
    actors.add(low).add(high);
    pairs.set(`${low}:${high}`, { low, high });
  };
  for (const fact of channels.values())
    if (fact.authority.kind === 'dm')
      pair(fact.authority.lowActorId, fact.authority.highActorId);
    else if (fact.authority.role !== null)
      for (const member of fact.authority.activeMemberActorIds)
        actors.add(member);
  for (const invitation of invitations.values())
    if (invitation.invitation.inviterActorId !== actorId)
      pair(invitation.invitation.inviterActorId, actorId);
  return {
    actors: [...actors].sort(),
    pairs: [...pairs.values()].sort(
      (a, b) => a.low.localeCompare(b.low) || a.high.localeCompare(b.high),
    ),
  };
}
export async function discoverInboxFacts(
  tx: Tx,
  actorId: string,
  channelIds: readonly string[],
): Promise<InboxDiscovery> {
  if (!channelIds.length)
    return {
      channels: new Map(),
      invitations: new Map(),
      actors: [actorId],
      pairs: [],
    };
  const pending = await pendingInvitations(tx, actorId, channelIds);
  const bindings = [
    ...channelIds.map((channelId) => ({ channelId, actorId })),
    ...pending.map((row) => ({
      channelId: row.channelId,
      actorId: row.inviterActorId,
    })),
  ];
  const facts = await readMessagingChannelFacts(tx, bindings);
  const channels = new Map<string, MessagingChannelFact>();
  for (const [index, channelId] of channelIds.entries()) {
    const fact = facts[index];
    if (fact) channels.set(channelId, fact);
  }
  const invitations = new Map<string, MessagingInboxInvitation>();
  for (const [index, row] of pending.entries()) {
    const fact = invitationFact(
      actorId,
      row,
      channels.get(row.channelId) ?? null,
      facts[channelIds.length + index] ?? null,
    );
    if (fact) invitations.set(row.channelId, fact);
  }
  return {
    channels,
    invitations,
    ...dependencies(actorId, channels, invitations),
  };
}
/** Restart when the fenced dependency set or any fact identity moved during waits. */
export function inboxFactSignature(discovery: InboxDiscovery) {
  return JSON.stringify([
    discovery.actors,
    discovery.pairs,
    [...discovery.channels.keys()].sort(),
    [...discovery.invitations.entries()]
      .map(([id, f]) => [id, f.invitation.inviterActorId])
      .sort(),
  ]);
}
