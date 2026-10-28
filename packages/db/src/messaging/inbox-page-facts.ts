import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  readAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import { actorIdsOf } from './authority-frame';
import { readMessagingChannelFacts, type MessagingChannelFact } from './social';

type Tx = AuthorizationTransaction;

const invitationRow = z.object({
  channelId: idSchema,
  invitedByActorId: idSchema,
  inviteeActorId: idSchema,
  generation: z.number().int().positive().safe(),
  state: z.string(),
});
export type InboxDiscovery = Awaited<ReturnType<typeof discoverInboxFacts>>;
type Pair = { readonly low: string; readonly high: string };
/** Every channel and invitation fact of the page, in two statements. */
export async function discoverInboxFacts(
  tx: Tx,
  actorId: string,
  channelIds: string[],
) {
  const invitations = channelIds.length
    ? (
        await tx.execute(sql`
          select channel_id as "channelId", invited_by_actor_id as "invitedByActorId",
            invitee_actor_id as "inviteeActorId", generation, state
          from public.messaging_group_invitations
          where invitee_actor_id = ${actorId}
            and channel_id in (select jsonb_array_elements_text(${JSON.stringify(channelIds)}::text::jsonb))
          order by channel_id`)
      ).map((row) => {
        const parsed = invitationRow.safeParse(row);
        if (!parsed.success) throw createAppError('INFRASTRUCTURE');
        return parsed.data;
      })
    : [];
  const facts = await readMessagingChannelFacts(tx, [
    ...channelIds.map((channelId) => ({ channelId, actorId })),
    ...invitations.map((row) => ({
      channelId: row.channelId,
      actorId: row.invitedByActorId,
    })),
  ]);
  const channels = new Map<string, MessagingChannelFact>();
  for (const [index, channelId] of channelIds.entries()) {
    const fact = facts[index];
    if (fact) channels.set(channelId, fact);
  }
  const inviters = new Map(
    invitations.flatMap((row, index) => {
      const inviter = facts[channelIds.length + index];
      return inviter ? [[row.channelId, { row, inviter }] as const] : [];
    }),
  );
  return { channels, inviters };
}
/** The complete account, pair and channel union, each in canonical order. */
export function inboxDependencies(actorId: string, discovery: InboxDiscovery) {
  const actors = new Set([actorId]);
  const pairs = new Map<string, Pair>();
  const pair = (a: string, b: string) => {
    const [low, high] = [a, b].sort() as [string, string];
    pairs.set(`${low}:${high}`, { low, high });
  };
  for (const fact of discovery.channels.values()) {
    for (const id of actorIdsOf(fact, actorId)) actors.add(id);
    if (fact.authority.kind === 'dm')
      pair(fact.authority.lowActorId, fact.authority.highActorId);
  }
  for (const { row } of discovery.inviters.values()) {
    actors.add(row.invitedByActorId);
    if (row.invitedByActorId !== actorId) pair(row.invitedByActorId, actorId);
  }
  return {
    actors: [...actors].sort(),
    pairs: [...pairs.values()].sort((a, b) =>
      a.low === b.low
        ? a.high.localeCompare(b.high)
        : a.low.localeCompare(b.low),
    ),
    channels: [...discovery.channels.values()]
      .map((fact) => ({
        id: fact.channelId,
        low: fact.authority.kind === 'dm' ? fact.authority.lowActorId : null,
        high: fact.authority.kind === 'dm' ? fact.authority.highActorId : null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
/** Fact identities a wait may move: any change restarts the whole page. */
export const inboxFactSignature = (
  actorId: string,
  discovery: InboxDiscovery,
) =>
  JSON.stringify([
    inboxDependencies(actorId, discovery),
    [...discovery.channels.values()].map((fact) => actorIdsOf(fact, actorId)),
    [...discovery.inviters.values()].map(({ row }) => [
      row.channelId,
      row.invitedByActorId,
    ]),
  ]);

const pairRow = z.object({
  lowActorId: idSchema,
  highActorId: idSchema,
  blocked: z.boolean(),
  revision: z.number().int().positive().safe(),
});
/**
 * The G4 SHARE fences, once, in the writers' order: accounts by user id,
 * then contact pairs, then channels by id. Returns the fenced accounts, the
 * present pairs and the channels whose fence held.
 */
export async function fenceInbox(
  tx: Tx,
  union: ReturnType<typeof inboxDependencies>,
) {
  const accounts = await readAuthorizationActors(tx, union.actors, {
    maxActors: 65535,
  });
  const pairs = union.pairs.length
    ? (
        await tx.execute(sql`
          select p.low_actor_id as "lowActorId", p.high_actor_id as "highActorId",
            (p.low_blocks_high or p.high_blocks_low) as blocked, p.revision
          from public.contact_pairs p
          join jsonb_to_recordset(${JSON.stringify(union.pairs)}::text::jsonb) as w(low text, high text)
            on p.low_actor_id = w.low and p.high_actor_id = w.high
          order by p.low_actor_id, p.high_actor_id
          for share of p`)
      ).map((row) => {
        const parsed = pairRow.safeParse(row);
        if (!parsed.success) throw createAppError('INFRASTRUCTURE');
        return parsed.data;
      })
    : [];
  // Volatile calls under ORDER BY run in sorted output order.
  const fenced = union.channels.length
    ? await tx.execute(sql`
        select w.id as "channelId",
          public.daisy_messaging_channel_read_fence(w.id, w.low, w.high) as locked
        from jsonb_to_recordset(${JSON.stringify(union.channels)}::text::jsonb) as w(id text, low text, high text)
        order by w.id`)
    : [];
  return {
    accounts: new Map(
      union.actors.map((id, index) => [id, accounts[index] ?? null]),
    ),
    pairs,
    held: new Set(
      fenced.flatMap((row) => (row.locked === true ? [row.channelId] : [])),
    ),
  };
}
