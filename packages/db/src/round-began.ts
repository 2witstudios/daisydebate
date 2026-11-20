import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { oweNotifications } from './notifications/owe';
import { query } from './raw-rows';
import type { Tx } from './tx';
import { z } from 'zod';

/**
 * The seated members a Round's start needs: every live account in a debater
 * or judge seat. A bot has no account, so it is never told.
 */
const seatedMembers = async (tx: Tx, roundId: string) =>
  query(
    tx,
    z.object({ user_id: z.string() }),
    sql`select distinct u.id as user_id from round_participants p
      join actors a on a.id=p.actor_id
      join users u on u.id=a.user_id and u.deleted_at is null
      where p.round_id=${roundId} order by u.id`,
  );

/**
 * The Round just began (`roundBegan`): tells its seated members, in the
 * transaction that started its clock. Urgent and never emailed: it is now
 * or never (ADR 0144).
 */
export async function oweRoundStarted(
  tx: Tx,
  input: { readonly roundId: string; readonly at: string },
): Promise<void> {
  const members = await seatedMembers(tx, input.roundId);
  await oweNotifications(tx, {
    kind: 'round_started',
    subject: { round_id: input.roundId },
    recipients: members.map((member) => ({
      userId: member.user_id,
      about: null,
    })),
    at: input.at,
    nextId: createId,
  });
}
