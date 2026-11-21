import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  recordSocialDecline,
  type SocialRequestLimits,
} from '../contacts/request-budget';
import { lockAuthorizationActors } from '../authorization';
import { query } from '../raw-rows';
import { contactPairs } from '../schema/contacts';
import { friendGuardianApprovals, friendships } from '../schema/friends';
import type { Tx } from '../tx';
import { guardianHoldsForRequest } from './guardian-approval-facts';
import { holdForGuardian } from './hold-for-guardian';
import { liveGuardianHold } from './guardian-approval-standing';
import { tellFriend } from './request-notice';

type ApprovalTx = Pick<
  Tx,
  'select' | 'update' | 'delete' | 'execute' | 'insert'
>;

/** The signed-in guardian's live approval inbox; no contact data or free text. */
export async function readWaitingFriendApprovals(
  tx: Pick<Tx, 'execute'>,
  guardianUserId: string,
) {
  return query(
    tx,
    z.object({
      id: z.string(),
      child: z.string(),
      counterpart: z.string(),
      direction: z.enum(['incoming', 'outgoing']),
    }),
    sql`select approval.id, child_user.username as child, other_user.username as counterpart,
      case when f.requester_actor_id=child.id then 'outgoing' else 'incoming' end as direction
      from guardian_links l
      join actors child on child.user_id=l.minor_user_id
      join users child_user on child_user.id=child.user_id and child_user.deleted_at is null
      join friend_guardian_approvals approval on approval.child_actor_id=child.id
      join friendships f using (low_actor_id, high_actor_id)
      join actors other on other.id=case when approval.low_actor_id=child.id
        then approval.high_actor_id else approval.low_actor_id end
      join users other_user on other_user.id=other.user_id and other_user.deleted_at is null
      where l.guardian_user_id=${guardianUserId} and l.status='active'
        and public.daisy_is_protection_guardian(child.id)
        and f.state='waiting-for-guardian' and ${liveGuardianHold(sql`approval`)}
        and child_user.username is not null and other_user.username is not null
      order by f.requested_at desc, approval.id
      limit 100`,
  );
}

export async function answerFriendApproval(
  tx: ApprovalTx,
  input: {
    readonly approvalId: string;
    readonly caller: { readonly userId: string; readonly actorId: string };
    readonly decision: 'approve' | 'decline';
    readonly at: string;
    readonly limits: SocialRequestLimits;
    readonly nextId: () => string;
  },
): Promise<boolean> {
  const { caller, approvalId } = input;
  const approvalKey = eq(friendGuardianApprovals.id, approvalId);
  const [initial] = await tx
    .select()
    .from(friendGuardianApprovals)
    .where(approvalKey);
  const authorized = async (childId: string) => {
    const [row] = await query(
      tx,
      z.object({ allowed: z.boolean() }),
      sql`select public.daisy_is_protection_guardian(${childId}) as allowed`,
    );
    return row?.allowed ?? false;
  };
  if (!initial || initial.cleared || !(await authorized(initial.childActorId)))
    return false;

  const actors = [
    ...new Set([caller.actorId, initial.lowActorId, initial.highActorId]),
  ];
  const accounts = await lockAuthorizationActors(tx, actors, { maxActors: 3 });
  const parent = accounts.find(
    (account) => account?.actorId === caller.actorId,
  );
  if (
    !parent?.member ||
    parent.erased ||
    parent.restricted ||
    parent.userId !== caller.userId ||
    parent.ageBand !== 'adult' ||
    !(await authorized(initial.childActorId))
  )
    return false;
  const pairAccounts = accounts.filter(
    (account) =>
      account?.actorId === initial.lowActorId ||
      account?.actorId === initial.highActorId,
  );
  if (
    pairAccounts.length !== 2 ||
    pairAccounts.some((account) => !account?.member || account.erased)
  )
    return false;

  const [contact] = await tx
    .select()
    .from(contactPairs)
    .where(
      and(
        eq(contactPairs.lowActorId, initial.lowActorId),
        eq(contactPairs.highActorId, initial.highActorId),
      ),
    )
    .for('update');
  if (!contact || contact.lowBlocksHigh || contact.highBlocksLow) return false;

  const pair = and(
    eq(friendships.lowActorId, initial.lowActorId),
    eq(friendships.highActorId, initial.highActorId),
  );
  const [request] = await tx
    .select()
    .from(friendships)
    .where(pair)
    .for('update');
  const [approval] = await tx
    .select()
    .from(friendGuardianApprovals)
    .where(approvalKey);
  if (
    !approval ||
    approval.cleared ||
    request?.state !== 'waiting-for-guardian'
  )
    return false;

  const holds = await guardianHoldsForRequest(
    tx,
    request,
    request.requesterActorId,
  );
  if (!holds.includes(approval.childActorId)) return false;

  if (input.decision === 'decline') {
    await tx.delete(friendships).where(pair);
    if (approval.childActorId !== request.requesterActorId)
      await recordSocialDecline(tx, {
        declinerActorId: approval.childActorId,
        requesterActorId: request.requesterActorId,
        now: input.at,
        limits: input.limits,
      });
    return true;
  }

  const [cleared] = await query(
    tx,
    z.object({ changed: z.boolean() }),
    sql`select public.daisy_clear_friend_guardian_hold(${approvalId}) as changed`,
  );
  if (!cleared?.changed) return false;
  const remaining = holds.filter((child) => child !== approval.childActorId);
  if (remaining.length) {
    for (const childActorId of remaining)
      await holdForGuardian(tx, {
        pair: request,
        childActorId,
        at: input.at,
        nextId: input.nextId,
      });
    return true;
  }
  await tx.update(friendships).set({ state: 'pending' }).where(pair);
  await tellFriend(tx, {
    kind: 'friend_request_received',
    pair: request,
    recipientActorId:
      request.requesterActorId === request.lowActorId
        ? request.highActorId
        : request.lowActorId,
    about: request.requesterActorId,
    at: input.at,
    nextId: input.nextId,
  });
  return true;
}
