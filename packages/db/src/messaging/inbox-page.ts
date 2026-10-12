import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError, isAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  loadAuthorizationAccount,
  readAuthorizationActors,
} from '../authorization';
import { authorizationAgeFacts } from '../authorization-age-batch';
import { assertObservationFactBudget } from '../observation-fact-boundary';
import {
  discoverInboxFacts,
  inboxFactSignature,
  type InboxDiscovery,
} from './inbox-page-facts';
import type {
  MessagingInboxDecision,
  MessagingInboxPage,
  MessagingInboxPageFacts,
  MessagingInboxScope,
} from './inbox-page-contracts';

/** Candidate pages are bounded technical work, not a product limit. */
export const MESSAGING_INBOX_SCAN_LIMIT = 50;
const ATTEMPTS = 3;
class CastChanged extends Error {}
type Owner = Pick<BunSQLDatabase, 'transaction'>;
type Tx = Parameters<Parameters<Owner['transaction']>[0]>[0];

function checkedScope(scope: MessagingInboxScope) {
  if (
    !idSchema.safeParse(scope.userId).success ||
    !idSchema.safeParse(scope.actorId).success ||
    !Number.isSafeInteger(scope.limit) ||
    scope.limit < 1 ||
    scope.limit > MESSAGING_INBOX_SCAN_LIMIT ||
    (scope.after !== undefined && !idSchema.safeParse(scope.after).success)
  )
    throw createAppError('VALIDATION');
}
/** Own associations only; hidden rows are scanned so the page bound covers them. */
async function scanCandidates(tx: Tx, scope: MessagingInboxScope) {
  const after = scope.after ?? null;
  const rows = await tx.execute(sql`
    select candidate.channel_id as "channelId", bool_or(coalesce(saved.hidden,false)) as hidden from (
      select channel_id from public.messaging_dm_pairs
      where (low_actor_id = ${scope.actorId} or high_actor_id = ${scope.actorId})
        and (${after}::text is null or channel_id > ${after}::text)
      union
      select channel_id from public.messaging_group_grants
      where actor_id = ${scope.actorId} and revoked_at is null
        and (${after}::text is null or channel_id > ${after}::text)
      union
      select channel_id from public.messaging_group_invitations
      where invitee_actor_id = ${scope.actorId} and state = 'pending'
        and (${after}::text is null or channel_id > ${after}::text)
      union
      select channel_id from public.messaging_actor_states
      where actor_id = ${scope.actorId}
        and (${after}::text is null or channel_id > ${after}::text)
    ) candidate
    left join public.messaging_actor_states saved
      on saved.actor_id = ${scope.actorId} and saved.channel_id = candidate.channel_id
    group by candidate.channel_id
    order by candidate.channel_id limit ${scope.limit}`);
  return rows.map((row) => {
    const channel = idSchema.safeParse(row.channelId);
    if (!channel.success || typeof row.hidden !== 'boolean')
      throw createAppError('INFRASTRUCTURE');
    return { channelId: channel.data, hidden: row.hidden };
  });
}
async function fence(tx: Tx, discovery: InboxDiscovery) {
  const accounts = await readAuthorizationActors(tx, discovery.actors, {
    maxActors: 4096,
  });
  const resources = [...discovery.channels.keys()].map((id) => ({
    kind: 'channel',
    id,
  }));
  const fenced = resources.length
    ? await tx.execute(
        sql`select resource_id as id from public.daisy_observation_authority_fences(${JSON.stringify(resources)}::text::jsonb,${JSON.stringify(discovery.pairs)}::text::jsonb)`,
      )
    : [];
  return { accounts, fenced: new Set(fenced.map((row) => String(row.id))) };
}
async function databaseInstant(tx: Tx) {
  const [edge] = await tx.execute(sql`select clock_timestamp() as now`);
  if (!(edge?.now instanceof Date) || !Number.isFinite(edge.now.getTime()))
    throw createAppError('INFRASTRUCTURE');
  return edge.now.toISOString();
}
async function contactPairs(tx: Tx, pairs: InboxDiscovery['pairs']) {
  if (!pairs.length) return [];
  const rows = await tx.execute(sql`
    select p.low_actor_id as "lowActorId",p.high_actor_id as "highActorId",
      (p.low_blocks_high or p.high_blocks_low) as blocked,p.revision
    from public.messaging_contact_pairs p
    join jsonb_to_recordset(${JSON.stringify(pairs)}::text::jsonb) wanted(low text,high text)
      on p.low_actor_id=wanted.low and p.high_actor_id=wanted.high
    order by p.low_actor_id,p.high_actor_id`);
  return rows.map((row) => ({
    lowActorId: String(row.lowActorId),
    highActorId: String(row.highActorId),
    blocked: row.blocked === true,
    revision: Number(row.revision),
  }));
}
/** Discover the complete bounded union, fence it once in canonical order, then read fresh facts. */
async function pageFacts(
  tx: Tx,
  scope: MessagingInboxScope,
): Promise<MessagingInboxPageFacts> {
  const scanned = await scanCandidates(tx, scope);
  const ids = scanned.map((c) => c.channelId);
  const discovered = await discoverInboxFacts(tx, scope.actorId, ids);
  assertObservationFactBudget(
    discovered.actors.length + discovered.pairs.length + ids.length,
  );
  const locked = await fence(tx, discovered);
  const current = await discoverInboxFacts(tx, scope.actorId, ids);
  if (
    inboxFactSignature(discovered) !== inboxFactSignature(current) ||
    [...current.channels.keys()].some((id) => !locked.fenced.has(id))
  )
    throw new CastChanged();
  const now = await databaseInstant(tx);
  const present = locked.accounts.flatMap((a) => (a ? [a] : []));
  const accounts = await authorizationAgeFacts(tx, present, now);
  return {
    principal: { userId: scope.userId, actorId: scope.actorId },
    account:
      present.find(
        (a) => a.actorId === scope.actorId && a.userId === scope.userId,
      ) ?? null,
    accounts: new Map(accounts.map((row) => [row.account.actorId!, row])),
    contactPairs: await contactPairs(tx, current.pairs),
    now,
    candidates: scanned.map(({ channelId, hidden }) => ({
      channelId,
      hidden,
      channel: current.channels.get(channelId) ?? null,
      invitation: current.invitations.get(channelId) ?? null,
    })),
  };
}
/**
 * One bounded candidate page and one batched authority transaction. Continuation is the last
 * scanned candidate, even when every scanned entry is filtered; infrastructure never reads as empty.
 */
export function createMessagingInboxPage(owner: Owner) {
  return async <T>(
    scope: MessagingInboxScope,
    decide: MessagingInboxDecision<T>,
  ): Promise<MessagingInboxPage<T>> => {
    checkedScope(scope);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++)
      try {
        return await owner.transaction(
          async (tx) => {
            decide.collection({
              account: await loadAuthorizationAccount(tx, scope.userId),
              now: await databaseInstant(tx),
            });
            const facts = await pageFacts(tx, scope);
            decide.collection(facts);
            const last = facts.candidates.at(-1)?.channelId ?? null;
            return {
              entries: decide.entries(facts),
              nextAfter: facts.candidates.length === scope.limit ? last : null,
            };
          },
          { isolationLevel: 'read committed' },
        );
      } catch (error) {
        if (error instanceof CastChanged) continue;
        if (isAppError(error)) throw error;
        throw createAppError('INFRASTRUCTURE', 'Inbox unavailable', error);
      }
    throw createAppError('INFRASTRUCTURE', 'Inbox unavailable');
  };
}
