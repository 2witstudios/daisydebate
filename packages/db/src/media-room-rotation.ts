import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RoundCommandAuthority } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { mediaId } from './media-session-authority';
import { mediaParticipants } from './schema/media-sessions';
import { mediaWorkerLeases } from './schema/transcript-segments';

/** Called only after the locked owner/epoch and settled absence proof pass. */
export async function rotateRevokedMediaRoom(
  tx: BoundedTransactionContext,
  sessionId: string,
  participants: RoundCommandAuthority['participants'],
  now: Date,
  nextId: () => string,
) {
  const revoked = participants
    .filter((seat) => seat.kind === 'human' && !seat.eligible)
    .map((seat) => seat.id);
  if (!revoked.length) return undefined;
  const removed = await tx
    .delete(mediaParticipants)
    .where(
      and(
        eq(mediaParticipants.sessionId, sessionId),
        inArray(mediaParticipants.roundParticipantId, revoked),
      ),
    )
    .returning({ id: mediaParticipants.id });
  if (!removed.length) return undefined;
  await tx
    .update(mediaWorkerLeases)
    .set({
      epoch: sql`${mediaWorkerLeases.epoch} + 1`,
      expiresAt: now,
    })
    .where(eq(mediaWorkerLeases.sessionId, sessionId));
  return mediaId(nextId());
}
