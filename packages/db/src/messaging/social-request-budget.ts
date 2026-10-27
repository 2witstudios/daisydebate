import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { instrumented, type DatabaseEventSink } from '../instrumented';
import { requireRetentionBounds, type RetentionBatch } from '../retention';

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

/** Whether `counterpartActorId`'s declines block `actorId`'s requests at `now`. */
const declineBlocks = (
  actorId: string,
  counterpartActorId: string,
  now: string,
) =>
  sql`exists(select 1 from messaging_social_declines
    where decliner_actor_id=${counterpartActorId} and requester_actor_id=${actorId}
      and blocked_until > ${now}::timestamptz)`;

/** Refuses a request the counterpart's declines block, exactly as a block is. */
export async function refuseDeclineBlock(
  tx: Tx,
  actorId: string,
  counterpartActorId: string,
  now: string,
) {
  if (!Number.isFinite(Date.parse(now))) throw createAppError('VALIDATION');
  const [row] = rowsOf<{ blocked: boolean }>(
    await tx.execute(
      sql`select ${declineBlocks(actorId, counterpartActorId, now)} as "blocked"`,
    ),
  );
  if (!row) throw createAppError('INFRASTRUCTURE');
  if (row.blocked) throw createAppError('AUTHORIZATION');
}

/**
 * Spends one DEC-251 social request from `actorId` to `counterpartActorId`,
 * under the requester's account lock and the pair lock the caller holds.
 * A request the recipient's declines block is refused exactly as a block
 * is (AUTHORIZATION), so neither is told apart from the other. Only an
 * accepted friendship or DM relates a pair: a pending or declined request
 * leaves it unrelated, so re-asking spends the unrelated budget. Otherwise
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
      ${declineBlocks(actorId, counterpartActorId, command.now)} as "declined",
      not exists(select 1 from messaging_friendships
          where low_actor_id=${low} and high_actor_id=${high} and state='accepted')
        and not exists(select 1 from messaging_dm_pairs
          where low_actor_id=${low} and high_actor_id=${high} and request_state='accepted') as "unrelated",
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
 * The row expires `declineBlockMs` after its last decline, which also
 * outlasts any block it holds, so the sweep needs no policy of its own.
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
  const until = at(now + limits.declineBlockMs);
  await tx.execute(sql`with counted as (
      select coalesce((select case when d.expires_at > ${command.now}::timestamptz
        then d.declined_count else 0 end
        from messaging_social_declines d
        where d.decliner_actor_id=${declinerActorId} and d.requester_actor_id=${requesterActorId}), 0) + 1 as next
    )
    insert into messaging_social_declines
      (decliner_actor_id, requester_actor_id, low_actor_id, high_actor_id, declined_count, last_declined_at, blocked_until, expires_at)
    select ${declinerActorId}, ${requesterActorId}, ${low}, ${high},
      case when next >= ${limits.declinesToBlock} then 0 else next end,
      ${command.now}::timestamptz,
      case when next >= ${limits.declinesToBlock} then ${until}::timestamptz end,
      ${until}::timestamptz
    from counted
    on conflict (decliner_actor_id, requester_actor_id) do update set
      declined_count = excluded.declined_count,
      last_declined_at = excluded.last_declined_at,
      expires_at = excluded.expires_at,
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

/**
 * DEC-251 retention: a decline row past its `expires_at` neither counts nor
 * blocks, so the sweep deletes it. One bounded autocommitted statement per
 * call, as in `deleteExpiredBatch`, over the row's two-column key.
 */
export const socialDeclineRetention = ({
  database,
  eventSink,
}: {
  readonly database: Pick<BunSQLDatabase, 'execute'>;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  purgeExpiredSocialDeclines: ({ before, limit }: RetentionBatch) =>
    instrumented(eventSink, 'purgeExpiredSocialDeclines', async () => {
      requireRetentionBounds({ before, limit });
      const deleted = await database.execute(sql`
        delete from messaging_social_declines
        where (decliner_actor_id, requester_actor_id) in (
          select decliner_actor_id, requester_actor_id from messaging_social_declines
          where expires_at < ${before}::timestamptz
          order by expires_at
          limit ${limit}
          for update skip locked
        ) returning decliner_actor_id`);
      return rowsOf(deleted).length;
    }),
});
