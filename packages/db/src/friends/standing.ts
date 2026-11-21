import { sql, type SQL } from 'drizzle-orm';
import {
  guardianWaitingLabel,
  liveGuardianHold,
} from './guardian-approval-standing';

/**
 * Friends' published reads (ADR 0144). `friendship` names the `friendships`
 * row in the reader's query; a declined, removed or blocked pair has no row.
 */

/** The friend request is still asked: nobody has answered it. */
export const friendRequestOpen = (friendship: SQL) =>
  sql`(${friendship}.state='pending' and ${guardianWaitingLabel(friendship)} is null)`;

/** The pair are friends. */
export const friendshipAccepted = (friendship: SQL) =>
  sql`(${friendship}.state='accepted')`;

/** Guardian notices stop standing once the request or this guardian's authority ends. */
export const guardianApprovalStanding = (notice: SQL, friendship: SQL) => sql`(
  ${friendship}.state='pending' and exists (
    select 1 from friend_guardian_approvals approval
    where approval.low_actor_id=${friendship}.low_actor_id
      and approval.high_actor_id=${friendship}.high_actor_id
      and ${notice}.user_id=public.daisy_subject_scope()
      and public.daisy_is_protection_guardian(approval.child_actor_id)
      and ${liveGuardianHold(sql`approval`)}
  )
)`;
