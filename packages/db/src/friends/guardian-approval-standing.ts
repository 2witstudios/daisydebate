import { sql, type SQL } from 'drizzle-orm';

export const liveGuardianHold = (approval: SQL) =>
  sql`public.daisy_own_friend_guardian_hold_live(${approval}.id)`;

export const guardianWaitingLabel = (friendship: SQL) =>
  sql<
    'waiting' | 'waiting-for-guardian' | null
  >`public.daisy_friend_guardian_waiting(
    ${friendship}.low_actor_id, ${friendship}.high_actor_id)`;
