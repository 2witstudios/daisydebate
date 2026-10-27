import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';

type Tx = Pick<BunSQLDatabase, 'execute'>;

/** DEC-251 social request budgets, shared by DM and friend requests. */
export type SocialRequestLimits = {
  /** Requests per account per rolling day. */
  readonly daily: number;
  /** Requests per account per rolling hour to accounts with no relation. */
  readonly unrelatedHourly: number;
  /** Declines by one person that block the requester... */
  readonly declinesToBlock: number;
  /** ...for this long; also how long a decline counts toward the block. */
  readonly declineBlockMs: number;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const rowsOf = <Row>(result: unknown) =>
  (Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? [])) as Row[];

const at = (now: number) => new Date(now).toISOString();

function requireLimits(limits: SocialRequestLimits, now: string) {
  const instant = Date.parse(now);
  if (
    !Number.isFinite(instant) ||
    !Object.values(limits).every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw createAppError('VALIDATION');
  return instant;
}

const ordered = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

/**
 * Spends one DEC-251 social request from `actorId` to `counterpartActorId`,
 * under the requester's account lock and the pair lock the caller holds.
 * A request the recipient's declines block is refused exactly as a block
 * is (AUTHORIZATION), so neither is told apart from the other. Otherwise
 * the request is appended to the ledger, which is the only thing the
 * budgets count: pair rows created or deleted later never refill them.
 */
export async function spendSocialRequest(
  tx: Tx,
  command: {
    readonly actorId: string;
    readonly counterpartActorId: string;
    readonly kind: 'dm.request' | 'friend.request';
    readonly requestId: string;
    readonly digest: string | null;
    readonly now: string;
    readonly limits: SocialRequestLimits;
  },
): Promise<(resultChannelId: string | null) => Promise<void>> {
  const now = requireLimits(command.limits, command.now);
  const { actorId, counterpartActorId, limits } = command;
  const [low, high] = ordered(actorId, counterpartActorId);
  const [facts] = rowsOf<{
    declined: boolean;
    unrelated: boolean;
    daily: number;
    hourly: number;
  }>(
    await tx.execute(sql`select
      exists(select 1 from messaging_social_declines
        where decliner_actor_id=${counterpartActorId} and requester_actor_id=${actorId}
          and blocked_until > ${at(now)}::timestamptz) as "declined",
      not exists(select 1 from messaging_friendships where low_actor_id=${low} and high_actor_id=${high})
        and not exists(select 1 from messaging_dm_pairs where low_actor_id=${low} and high_actor_id=${high}) as "unrelated",
      (select count(*)::int from messaging_social_commands
        where actor_id=${actorId} and kind in ('dm.request','friend.request')
          and created_at > ${at(now - DAY_MS)}::timestamptz) as "daily",
      (select count(*)::int from messaging_social_commands
        where actor_id=${actorId} and kind in ('dm.request','friend.request') and unrelated
          and created_at > ${at(now - HOUR_MS)}::timestamptz) as "hourly"`),
  );
  if (!facts) throw createAppError('INFRASTRUCTURE');
  if (facts.declined) throw createAppError('AUTHORIZATION');
  if (
    facts.daily >= limits.daily ||
    (facts.unrelated && facts.hourly >= limits.unrelatedHourly)
  )
    throw createAppError('RATE_LIMIT');
  return async (resultChannelId) => {
    await tx.execute(sql`insert into messaging_social_commands
      (actor_id, request_id, counterpart_actor_id, kind, digest, result_channel_id, created_at, unrelated)
      values (${actorId}, ${command.requestId}, ${counterpartActorId}, ${command.kind},
        ${command.digest}, ${resultChannelId}, ${command.now}::timestamptz, ${facts.unrelated})`);
  };
}

/**
 * Records that `declinerActorId` declined `requesterActorId`. A decline
 * counts for `declineBlockMs`; reaching `declinesToBlock` blocks further
 * requests in that direction for `declineBlockMs` and starts the count over.
 */
export async function recordSocialDecline(
  tx: Tx,
  command: {
    readonly declinerActorId: string;
    readonly requesterActorId: string;
    readonly now: string;
    readonly limits: SocialRequestLimits;
  },
) {
  const now = requireLimits(command.limits, command.now);
  const { declinerActorId, requesterActorId, limits } = command;
  const [low, high] = ordered(declinerActorId, requesterActorId);
  const stale = at(now - limits.declineBlockMs),
    until = at(now + limits.declineBlockMs);
  await tx.execute(sql`with counted as (
      select coalesce((select case when d.last_declined_at > ${stale}::timestamptz
        then d.declined_count else 0 end
        from messaging_social_declines d
        where d.decliner_actor_id=${declinerActorId} and d.requester_actor_id=${requesterActorId}), 0) + 1 as next
    )
    insert into messaging_social_declines
      (decliner_actor_id, requester_actor_id, low_actor_id, high_actor_id, declined_count, last_declined_at, blocked_until)
    select ${declinerActorId}, ${requesterActorId}, ${low}, ${high},
      case when next >= ${limits.declinesToBlock} then 0 else next end,
      ${command.now}::timestamptz,
      case when next >= ${limits.declinesToBlock} then ${until}::timestamptz end
    from counted
    on conflict (decliner_actor_id, requester_actor_id) do update set
      declined_count = excluded.declined_count,
      last_declined_at = excluded.last_declined_at,
      blocked_until = coalesce(excluded.blocked_until,
        case when messaging_social_declines.blocked_until > ${command.now}::timestamptz
          then messaging_social_declines.blocked_until end)`);
}

/** An accepted request clears the pair's declines in both directions. */
export async function clearSocialDeclines(tx: Tx, a: string, b: string) {
  const [low, high] = ordered(a, b);
  await tx.execute(
    sql`delete from messaging_social_declines where low_actor_id=${low} and high_actor_id=${high}`,
  );
}
