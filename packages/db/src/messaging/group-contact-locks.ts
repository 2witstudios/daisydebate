import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { AuthorizationTransaction } from '../authorization';
import { messagingContactPairs } from '../schema/messaging-social';
import type { MessagingGroupInvitationFact } from './group-invitation-contracts';
/** Only requested admission may materialize a pair; all refusals roll the same tx back. */
export async function lockGroupContacts(
  tx: AuthorizationTransaction,
  actors: readonly string[],
  materialize: boolean,
): Promise<MessagingGroupInvitationFact['contactPairs']> {
  const members = [...new Set(actors)].sort();
  if ((members.length * (members.length - 1)) / 2 > 65535)
    throw createAppError('VALIDATION');
  const result: Array<MessagingGroupInvitationFact['contactPairs'][number]> =
    [];
  for (const [index, lowActorId] of members.entries())
    for (const highActorId of members.slice(index + 1)) {
      if (materialize)
        await tx
          .insert(messagingContactPairs)
          .values({ lowActorId, highActorId })
          .onConflictDoNothing();
      const rows = await tx.execute(
        sql`select low_blocks_high,high_blocks_low,revision from public.messaging_contact_pairs where low_actor_id=${lowActorId} and high_actor_id=${highActorId} for update`,
      );
      const pair = rows[0];
      if (!pair) continue;
      result.push(parseContact(pair, lowActorId, highActorId));
    }
  return result;
}

const contactColumns = z.object({
  low_blocks_high: z.boolean(),
  high_blocks_low: z.boolean(),
  revision: z.coerce.number().int().positive().safe(),
});
function parseContact(row: unknown, lowActorId: string, highActorId: string) {
  const parsed = contactColumns.safeParse(row);
  if (!parsed.success) throw createAppError('INFRASTRUCTURE');
  return {
    lowActorId,
    highActorId,
    blocked: parsed.data.low_blocks_high || parsed.data.high_blocks_low,
    revision: parsed.data.revision,
  };
}
