import { sql, type SQL } from 'drizzle-orm';

/**
 * Friends' published reads (ADR 0144). `friendship` names the `friendships`
 * row in the reader's query; a declined, removed or blocked pair has no row.
 */

/** The friend request is still asked: nobody has answered it. */
export const friendRequestOpen = (friendship: SQL) =>
  sql`(${friendship}.state='pending')`;

/** The pair are friends. */
export const friendshipAccepted = (friendship: SQL) =>
  sql`(${friendship}.state='accepted')`;

/** Guardian notices stop standing once the request or this guardian's authority ends. */
export const guardianApprovalStanding = (notice: SQL, friendship: SQL) => sql`(
  ${friendship}.state='waiting-for-guardian' and exists (
    select 1 from friend_guardian_approvals approval
    join actors child on child.id=approval.child_actor_id
    cross join lateral public.daisy_protection_guardians(child.user_id) guardian
    where approval.low_actor_id=${friendship}.low_actor_id
      and approval.high_actor_id=${friendship}.high_actor_id
      and guardian.user_id=${notice}.user_id
      and not approval.cleared
  )
)`;
