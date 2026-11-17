import { createId } from '@paralleldrive/cuid2';
import type { SQL } from 'bun';

/**
 * Fills a constructing Round's frozen judge slots with fresh judge accounts, so
 * it can complete (rounds_judge_slots_complete). Call it in the transaction that
 * inserted the Round, while it is still active: the cast froze at Start.
 */
export async function seatJudges(
  tx: SQL,
  roundId: string,
  judges: number,
): Promise<void> {
  for (let slot = 0; slot < judges; slot += 1) {
    const userId = createId();
    const actorId = createId();
    await tx`insert into users (id,username,email_verified) values (${userId},${`judge-${userId}`},true)`;
    await tx`insert into actors (id,kind,user_id) values (${actorId},'human',${userId})`;
    await tx`insert into round_participants (id,round_id,actor_id,seat_kind,slot)
      values (${createId()},${roundId},${actorId},'judge',${slot})`;
  }
}
