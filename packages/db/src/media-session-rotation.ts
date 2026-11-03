import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RoundCommandAuthority } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { mediaId } from './media-session-authority';
import { mediaParticipants } from './schema/media-sessions';
import { mediaWorkerLeases } from './schema/transcript-segments';

/**
 * Drops revoked human seats from the media session and fences its worker
 * lease; returns the next vendor room name, so the session moves to a fresh
 * LiveKit room. Called only after the locked owner/epoch and settled absence
 * proof pass.
 */
export async function rotateMediaRoom(
  tx: BoundedTransactionContext,
  sessionId: string,
  participants: RoundCommandAuthority['participants'],
  now: Date,
  nextId: () => string,
  /** The room's state is unknown, so it is left behind even with every seat eligible. */
  uncertain: boolean,
) {
  const revoked = participants
    .filter((seat) => seat.kind === 'human' && !seat.eligible)
    .map((seat) => seat.id);
  const removed = revoked.length
    ? await tx
        .delete(mediaParticipants)
        .where(
          and(
            eq(mediaParticipants.sessionId, sessionId),
            inArray(mediaParticipants.roundParticipantId, revoked),
          ),
        )
        .returning({ id: mediaParticipants.id })
    : [];
  if (!removed.length && !uncertain) return undefined;
  await tx
    .update(mediaWorkerLeases)
    .set({
      epoch: sql`${mediaWorkerLeases.epoch} + 1`,
      expiresAt: now,
    })
    .where(eq(mediaWorkerLeases.sessionId, sessionId));
  return mediaId(nextId());
}
