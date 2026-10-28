import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError, isAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  loadAuthorizationAccount,
  type AuthorizationTransaction,
} from '../authorization';
import type { authorizationAccountFact } from '../authorization-account';
import {
  loadAuthorizationAgeFacts,
  type AuthorizationAgeFact,
} from '../authorization-age';
import { actorIdsOf, castChanged, restartingRead } from './authority-frame';
import { groupInvitationFact } from './group-invitation-facts';
import type { MessagingGroupInvitationFact } from './group-invitation-contracts';
import {
  readMessagingInboxSummaries,
  type MessagingInboxSummary,
} from './inbox-summary';
import type { MessagingChannelFact } from './social';
import {
  discoverInboxFacts,
  fenceInbox,
  inboxDependencies,
  inboxFactSignature,
  type InboxDiscovery,
} from './inbox-page-facts';

type Account = NonNullable<ReturnType<typeof authorizationAccountFact>>;
type MessagingInboxScope = {
  readonly userId: string;
  readonly actorId: string;
  readonly limit: number;
  readonly after?: string;
  /** The caller's clock instant, for age facts read under the fences. */
  readonly now: string;
};
/** A frame's fenced accounts, in its sorted cast order; absent accounts are null. */
type Framed<F> = {
  readonly fact: F;
  readonly accounts: readonly (Account | null)[];
};
export type MessagingInboxCandidate = {
  readonly channelId: string;
  /** The reader's own channel authority; null when absent or unfenceable. */
  readonly channel: Framed<MessagingChannelFact> | null;
  /** The reader's own invitation to it, with the inviter/invitee contact pair. */
  readonly invitation: Framed<MessagingGroupInvitationFact> | null;
};
type MessagingInboxSummaryRequest = {
  readonly counterpartActorId: string | null;
  readonly content: 'messages' | 'introduction';
};
/**
 * Pure policy over fenced facts. `collection` throws to deny the inbox; it runs
 * on an unfenced read before any association is scanned, then on the fenced
 * account. `decide` returns null to omit a candidate; a decision naming a
 * summary is shown with that summary, read only for allowed entries.
 */
export type MessagingInboxPolicy<D> = {
  readonly collection: (account: Account | null) => void;
  readonly decide: (
    candidate: MessagingInboxCandidate,
    ageOf: (account: Account) => AuthorizationAgeFact,
  ) => Promise<D | null>;
  readonly summaryOf: (decision: D) => MessagingInboxSummaryRequest | null;
};
export type MessagingInboxPage<D> = {
  readonly entries: readonly {
    readonly channelId: string;
    readonly decision: D;
    readonly summary: MessagingInboxSummary | null;
  }[];
  /** The last scanned candidate of a full scan, even when none is shown. */
  readonly nextAfter: string | null;
};
type Tx = AuthorizationTransaction;

function checkedScope(scope: MessagingInboxScope) {
  if (
    !idSchema.safeParse(scope.userId).success ||
    !idSchema.safeParse(scope.actorId).success ||
    !Number.isSafeInteger(scope.limit) ||
    scope.limit < 1 ||
    scope.limit > 65535 ||
    (scope.after !== undefined && !idSchema.safeParse(scope.after).success)
  )
    throw createAppError('VALIDATION');
}
/**
 * Own associations only. Hidden rows are scanned and counted, so the page
 * bound covers them and a hidden run still advances the continuation.
 */
async function scanCandidates(tx: Tx, scope: MessagingInboxScope) {
  const after = scope.after ?? null;
  const rows = await tx.execute(sql`
    select candidate.channel_id as "channelId", coalesce(saved.hidden, false) as hidden from (
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
    order by candidate.channel_id limit ${scope.limit}`);
  return rows.map((row) => {
    const channel = idSchema.safeParse(row.channelId);
    if (!channel.success || typeof row.hidden !== 'boolean')
      throw createAppError('INFRASTRUCTURE');
    return { channelId: channel.data, hidden: row.hidden };
  });
}

type Fenced = Awaited<ReturnType<typeof fenceInbox>>;
function candidateOf(
  actorId: string,
  channelId: string,
  discovery: InboxDiscovery,
  fenced: Fenced,
): MessagingInboxCandidate {
  const framed = <F>(fact: F, cast: readonly string[]): Framed<F> => ({
    fact,
    accounts: cast.map((id) => fenced.accounts.get(id) ?? null),
  });
  const fact = fenced.held.has(channelId)
    ? (discovery.channels.get(channelId) ?? null)
    : null;
  const invited = discovery.inviters.get(channelId);
  let invitation: MessagingInboxCandidate['invitation'] = null;
  if (fact?.authority.kind === 'private_group' && invited) {
    const { row, inviter } = invited;
    const [low, high] = [row.invitedByActorId, actorId].sort();
    try {
      invitation = framed(
        groupInvitationFact(
          fact,
          inviter,
          row,
          fenced.pairs.filter(
            (p) => p.lowActorId === low && p.highActorId === high,
          ),
        ),
        actorIdsOf(fact, actorId, [row.invitedByActorId, actorId]),
      );
    } catch (error) {
      // A retained group has no invitation preview; anything else is an outage.
      if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error;
    }
  }
  return {
    channelId,
    channel: fact ? framed(fact, actorIdsOf(fact, actorId)) : null,
    invitation,
  };
}

async function readPage<D>(
  tx: Tx,
  scope: MessagingInboxScope,
  policy: MessagingInboxPolicy<D>,
): Promise<MessagingInboxPage<D>> {
  policy.collection(await loadAuthorizationAccount(tx, scope.userId));
  const scanned = await scanCandidates(tx, scope);
  const visible = scanned.flatMap((c) => (c.hidden ? [] : [c.channelId]));
  const discovered = await discoverInboxFacts(tx, scope.actorId, visible);
  const fenced = await fenceInbox(
    tx,
    inboxDependencies(scope.actorId, discovered),
  );
  const current = await discoverInboxFacts(tx, scope.actorId, visible);
  if (
    inboxFactSignature(scope.actorId, discovered) !==
    inboxFactSignature(scope.actorId, current)
  )
    throw castChanged();
  const own = fenced.accounts.get(scope.actorId) ?? null;
  policy.collection(own?.userId === scope.userId ? own : null);
  const ageOf = await ages(tx, [...fenced.accounts.values()], scope.now);
  const decided: { channelId: string; decision: D }[] = [];
  for (const channelId of visible) {
    const decision = await policy.decide(
      candidateOf(scope.actorId, channelId, current, fenced),
      ageOf,
    );
    if (decision !== null) decided.push({ channelId, decision });
  }
  const wanted = decided.flatMap(({ channelId, decision }) => {
    const request = policy.summaryOf(decision);
    return request ? [{ channelId, ...request }] : [];
  });
  const summaries = await readMessagingInboxSummaries(
    tx,
    scope.actorId,
    wanted,
  );
  const byChannel = new Map(
    wanted.map((request, index) => [request.channelId, summaries[index]]),
  );
  return {
    entries: decided.flatMap(
      ({ channelId, decision }): MessagingInboxPage<D>['entries'] => {
        if (!byChannel.has(channelId))
          return [{ channelId, decision, summary: null }];
        const summary = byChannel.get(channelId);
        return summary ? [{ channelId, decision, summary }] : [];
      },
    ),
    nextAfter:
      scanned.length === scope.limit
        ? (scanned.at(-1)?.channelId ?? null)
        : null,
  };
}
/** Every fenced member account's age fact, in one statement. */
async function ages(
  tx: Tx,
  accounts: readonly (Account | null)[],
  now: string,
) {
  const members = accounts.filter(
    (a): a is Account & { actorId: string } =>
      a !== null && a.actorId !== null && a.member && !a.erased,
  );
  const facts = await loadAuthorizationAgeFacts(
    tx,
    members.map((a) => ({
      userId: a.userId,
      actorId: a.actorId,
      accountRevision: a.revision,
      now,
    })),
  );
  const byActor = new Map(members.map((a, i) => [a.actorId, facts[i]!]));
  return (account: Account): AuthorizationAgeFact =>
    (account.actorId !== null &&
      account.member &&
      !account.erased &&
      byActor.get(account.actorId)) || { state: 'unknown' };
}
/**
 * One inbox page in one bounded transaction (MSG-2.2-arch1-inbox1): scan,
 * discover the whole union, fence it once, verify the cast, then decide and
 * summarize. A cast that keeps moving is a retryable outage, never stale.
 */
export function createMessagingInboxPage(
  database: Pick<BunSQLDatabase, 'transaction'>,
) {
  return <D>(
    scope: MessagingInboxScope,
    policy: MessagingInboxPolicy<D>,
  ): Promise<MessagingInboxPage<D>> => {
    checkedScope(scope);
    return restartingRead(database, (tx) => readPage(tx, scope, policy));
  };
}
