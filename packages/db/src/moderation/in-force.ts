import { sql, type SQL } from 'drizzle-orm';

/** The one rule for a sanction in force, in SQL (ADR 0103), on `moderation_actions`. */
export const actionInForce = (at: Date) =>
  sql`public.daisy_moderation_action_in_force(moderation_actions.kind, moderation_actions.starts_at, moderation_actions.ends_at, moderation_actions.lifted_at, ${at}::timestamptz)`;

/** Moderation's published read: the user named by `userId` is restricted at `at`. */
export const restrictionInForce = (userId: SQL, at: Date) =>
  sql`public.daisy_restriction_in_force(${userId}, ${at}::timestamptz)`;
