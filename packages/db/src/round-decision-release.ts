import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import type { NotificationRecipient } from './notifications/owe';
import { oweNotifications, resurfaceNotifications } from './notifications/owe';
import { rowsOf } from './raw-rows';
import type { Tx } from './tx';

/**
 * Who is told a Round's decision by default: every live account seated in it
 * now, each about the member across from them (a judge, about the first
 * side's first seat).
 */
export const roundDecisionAudience = async (
  tx: Tx,
  roundId: string,
): Promise<readonly NotificationRecipient[]> =>
  (
    await rowsOf<{ user_id: string; about: string }>(
      tx,
      // Tab's seats (TAB-6): across from a side is the first seat of another
      // side, in the format's declared side order (the Round's frozen rules);
      // a judge or unsided seat reads about the first declared side's. A seat
      // retired from the Round (a replaced judge) is told nothing.
      sql`select distinct on (u.id) u.id as user_id,
          coalesce((select o.actor_id from round_participants o
            where o.round_id=p.round_id and o.seat_kind='side'
              and o.side is distinct from p.side
              and public.daisy_round_participant_is_current(o.id)
            order by (select e.ord from jsonb_array_elements(r.rules_snapshot->'sides')
                with ordinality as e(side,ord) where e.side->>'key'=o.side),o.slot
            limit 1),p.actor_id) as about
        from round_participants p
        join rounds r on r.id=p.round_id
        join actors a on a.id=p.actor_id
        join users u on u.id=a.user_id and u.deleted_at is null
        where p.round_id=${roundId}
          and public.daisy_round_participant_is_current(p.id)
        order by u.id,coalesce(p.side,p.seat_kind),p.slot`,
    )
  ).map((row) => ({ userId: row.user_id, about: row.about }));

/**
 * Tells `recipients` a Round's decision is in (ADR 0144). Finalization calls
 * it for a Round frozen `on_finalize`; a `held` Round's organizer calls it
 * when they release, with the audience they resolved.
 */
export async function releaseRoundDecision(
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly at: string;
    readonly recipients: readonly NotificationRecipient[];
  },
): Promise<void> {
  await oweNotifications(tx, {
    kind: 'round_decision_released',
    subject: { round_id: input.roundId },
    recipients: input.recipients,
    at: input.at,
    nextId: createId,
  });
}

/** The Round was just finalized: tells its seats now, unless its release is held. */
export async function releaseFinalizedDecision(
  tx: Tx,
  input: { readonly roundId: string; readonly at: string },
): Promise<void> {
  const [round] = await rowsOf<{ decision_release: string }>(
    tx,
    sql`select decision_release from rounds where id=${input.roundId}`,
  );
  if (round?.decision_release !== 'on_finalize') return;
  await releaseRoundDecision(tx, {
    ...input,
    recipients: await roundDecisionAudience(tx, input.roundId),
  });
}

/**
 * One participant's analysis of the Round is ready: their decision
 * notification comes back unread, so the analysis is read beside it.
 */
export const resurfaceRoundDecision = (
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly userIds: readonly string[];
    readonly at: string;
  },
) =>
  resurfaceNotifications(tx, {
    kind: 'round_decision_released',
    subject: { round_id: input.roundId },
    userIds: input.userIds,
    at: input.at,
    nextId: createId,
  });
