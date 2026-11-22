import { createAppError } from '@daisy/errors';
import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import type { NotificationRecipient } from './notifications/owe';
import { oweNotifications, resurfaceNotifications } from './notifications/owe';
import { query } from './raw-rows';
import type { Tx } from './tx';
import { z } from 'zod';

/**
 * Who is told a Round's decision by default: every live account seated in it
 * now, each about the member across from them (a judge, about the first
 * side's first seat).
 */
export async function roundDecisionAudience(
  tx: Tx,
  roundId: string,
  policy: DecisionReleasePolicy,
): Promise<readonly NotificationRecipient[]> {
  const seats = await query(
    tx,
    z.object({
      actorId: z.string(),
      userId: z.string().nullable(),
      erased: z.boolean(),
      current: z.boolean(),
      kind: z.string(),
      side: z.string().nullable(),
      slot: z.number(),
      sideOrder: z.number().nullable(),
    }),
    sql`select p.actor_id as "actorId", u.id as "userId",
      u.deleted_at is not null as erased,
      coalesce(public.daisy_round_participant_is_current(p.id),false) as current,
      p.seat_kind as kind,p.side,p.slot,
      (select e.ord::int from jsonb_array_elements(r.rules_snapshot->'sides')
        with ordinality as e(side,ord) where e.side->>'key'=p.side) as "sideOrder"
    from round_participants p
    join rounds r on r.id=p.round_id
    join actors a on a.id=p.actor_id
    left join users u on u.id=a.user_id
    where p.round_id=${roundId}
    order by u.id,coalesce(p.side,p.seat_kind),p.slot`,
  );
  return policy.audience(seats);
}

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
  policy: DecisionReleasePolicy | undefined,
): Promise<void> {
  if (!policy)
    throw createAppError(
      'INVARIANT',
      'Finalization requires decision release policy',
    );
  const [round] = await query(
    tx,
    z.object({ decision_release: z.string() }),
    sql`select decision_release from rounds where id=${input.roundId}`,
  );
  if (!policy.release(round?.decision_release ?? null)) return;
  await releaseRoundDecision(tx, {
    ...input,
    recipients: await roundDecisionAudience(tx, input.roundId, policy),
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
