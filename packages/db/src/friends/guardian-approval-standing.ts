import { sql, type SQL } from 'drizzle-orm';
import { parsedColumn } from '../raw-rows';
import { z } from 'zod';

export const liveGuardianHold = (approval: SQL) =>
  sql`public.daisy_own_friend_guardian_hold_live(${approval}.id)`;

export const guardianWaitingLabel = (friendship: SQL) =>
  parsedColumn(
    z.enum(['waiting', 'waiting-for-guardian']).nullable(),
    sql`public.daisy_friend_guardian_waiting(
    ${friendship}.low_actor_id, ${friendship}.high_actor_id)`,
  );
