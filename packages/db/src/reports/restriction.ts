import { sql, type SQL } from 'drizzle-orm';

/**
 * Moderation's published read for another query: a suspension or ban is in
 * force at `at` for the user named by `userId`, the rule the account producer
 * applies (ADR 0098).
 */
export const restrictionInForce = (userId: SQL, at: Date) =>
  sql`exists (select 1 from moderation_actions m
    where m.user_id = ${userId} and m.kind in ('suspension', 'ban') and m.lifted_at is null
      and m.starts_at <= ${at} and (m.ends_at is null or m.ends_at > ${at}))`;
