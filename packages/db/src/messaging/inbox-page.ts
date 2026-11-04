import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError, isAppError } from '@daisy/errors';
import {
  decodeMessagingInboxCursor,
  encodeMessagingInboxCursor,
  idSchema,
  messagingBetaLimits,
  messagingInboxSearchLine,
  messagingInboxPreviewMax,
} from '@daisy/protocol';
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
  /** A literal match on what a row shows: never invitations or older history. */
  readonly search?: string;
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
    (scope.after !== undefined &&
      decodeMessagingInboxCursor(scope.after) === null) ||
    (scope.search !== undefined &&
      (scope.search.length > messagingBetaLimits.queryUnits ||
        messagingInboxSearchLine(scope.search) === ''))
  )
    throw createAppError('VALIDATION');
}
const LEAD_ACTIVITY = '1970-01-01T00:00:00.000Z';
/** The whitespace JavaScript's `\\s` means, so both sides collapse the same runs. */
const JS_WHITESPACE_RUN =
  '[\\t\\n\\v\\f\\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+';

/**
 * Own associations only, newest activity first across every page (ISSUE-604):
 * the same instant a row shows, to its millisecond, with the channel as
 * tie-break. An invitation has no activity its invitee may learn, so it leads
 * on a fixed instant. A search here is only a prefilter, never narrower than
 * what a row shows: PostgreSQL counts characters and JavaScript UTF-16 units,
 * so the caller rechecks each final rendered entry. The fenced decision still
 * decides every match. Hidden rows are scanned
 * and counted, so the page bound covers them and a hidden run still advances
 * the continuation.
 */
async function scanCandidates(tx: Tx, scope: MessagingInboxScope) {
  const cursor =
    scope.after === undefined ? null : decodeMessagingInboxCursor(scope.after);
  const afterRank =
    cursor === null || cursor.kind === 'withheld'
      ? null
      : cursor.kind === 'invitation'
        ? 0
        : 1;
  const afterActivity =
    cursor?.kind === 'activity'
      ? cursor.activityAt
      : cursor?.kind === 'invitation'
        ? LEAD_ACTIVITY
        : null;
  const afterChannel = cursor?.channelId ?? null;
  const search =
    scope.search === undefined ? null : messagingInboxSearchLine(scope.search);
  const rows = await tx.execute(sql`
    with ranked as (
      select candidate.channel_id, coalesce(saved.hidden, false) as hidden,
        led.invited as lead,
        case when led.invited then 0 else 1 end as rank,
        case when led.invited then ${LEAD_ACTIVITY}::timestamptz
          else date_trunc('milliseconds', coalesce(
            case when pair.request_state = 'pending' then pair.requested_at end,
            last.created_at, channel.created_at))
        end as activity,
        case when pair.channel_id is null then channel.title else counterpart.username end as title,
        case when pair.request_state = 'pending' then pair.introduction else last.text end as line
      from (
        select channel_id from public.messaging_dm_pairs
        where low_actor_id = ${scope.actorId} or high_actor_id = ${scope.actorId}
        union
        select channel_id from public.messaging_group_grants
        where actor_id = ${scope.actorId} and revoked_at is null
        union
        select channel_id from public.messaging_group_invitations
        where invitee_actor_id = ${scope.actorId} and state = 'pending'
        union
        select channel_id from public.messaging_actor_states
        where actor_id = ${scope.actorId}
      ) candidate
      join public.messaging_channels channel on channel.id = candidate.channel_id
      left join public.messaging_actor_states saved
        on saved.actor_id = ${scope.actorId} and saved.channel_id = candidate.channel_id
      left join public.messaging_dm_pairs pair on pair.channel_id = candidate.channel_id
      left join lateral (
        select u.username from public.actors a join public.users u on u.id = a.user_id
        where a.id = case when pair.low_actor_id = ${scope.actorId} then pair.high_actor_id else pair.low_actor_id end
          and u.deleted_at is null
      ) counterpart on true
      left join lateral (
        select m.text, m.created_at from public.messaging_messages m
        where m.channel_id = candidate.channel_id and m.removed_at is null
        order by m.sequence desc limit 1
      ) last on true
      cross join lateral (
        select pair.channel_id is null
          and exists (select 1 from public.messaging_group_invitations i
            where i.channel_id = candidate.channel_id and i.invitee_actor_id = ${scope.actorId} and i.state = 'pending')
          and not exists (select 1 from public.messaging_group_grants g
            where g.channel_id = candidate.channel_id and g.actor_id = ${scope.actorId} and g.revoked_at is null)
          as invited
      ) led
    ), after_position as (
      select ${afterChannel}::text as channel_id,
        coalesce(${afterRank}::integer, (select rank from ranked where channel_id = ${afterChannel}::text)) as rank,
        coalesce(${afterActivity}::timestamptz, (select activity from ranked where channel_id = ${afterChannel}::text)) as activity
    )
    select ranked.channel_id as "channelId", ranked.hidden as hidden, ranked.rank as rank,
      to_char(ranked.activity at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as activity
    from ranked cross join after_position position
    where (position.channel_id is null or position.rank is null
        or ranked.rank > position.rank
        or (ranked.rank = position.rank and (
          ranked.activity < position.activity
          or (ranked.activity = position.activity and ranked.channel_id > position.channel_id))))
      and (${search}::text is null or (not ranked.lead and (
        strpos(${search}::text, '…') > 0 or strpos(lower(coalesce(ranked.title, '')), lower(${search}::text)) > 0
        or strpos(lower(left(btrim(regexp_replace(coalesce(ranked.line, ''), ${JS_WHITESPACE_RUN}::text, ' ', 'g')), ${messagingInboxPreviewMax}::integer)), lower(${search}::text)) > 0)))
    order by ranked.rank, ranked.activity desc, ranked.channel_id
    limit ${scope.limit}`);
  return rows.map((row) => {
    const channel = idSchema.safeParse(row.channelId);
    if (
      !channel.success ||
      typeof row.hidden !== 'boolean' ||
      typeof row.activity !== 'string'
    )
      throw createAppError('INFRASTRUCTURE');
    return {
      channelId: channel.data,
      hidden: row.hidden,
      cursor: encodeMessagingInboxCursor(
        Number(row.rank) === 0
          ? { kind: 'invitation', channelId: channel.data }
          : {
              kind: 'activity',
              activityAt: row.activity,
              channelId: channel.data,
            },
      ),
    };
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
  const entries = decided.flatMap(
    ({ channelId, decision }): MessagingInboxPage<D>['entries'] => {
      if (!byChannel.has(channelId))
        return [{ channelId, decision, summary: null }];
      const summary = byChannel.get(channelId);
      return summary ? [{ channelId, decision, summary }] : [];
    },
  );
  const last = scanned.at(-1);
  return {
    entries,
    // A denied or hidden entry contributes no private activity to a public cursor.
    nextAfter:
      scanned.length === scope.limit && last
        ? entries.some((entry) => entry.channelId === last.channelId)
          ? last.cursor
          : encodeMessagingInboxCursor({
              kind: 'withheld',
              channelId: last.channelId,
            })
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
