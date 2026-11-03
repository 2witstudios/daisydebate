import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RoundCommandAuthority } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { mediaId } from './media-session-authority';
import { mediaParticipants } from './schema/media-sessions';
import { mediaWorkerLeases } from './schema/transcript-segments';

/** Bound human seats that have lost their place, by round participant. */
export async function revokedBoundSeats(
  tx: BoundedTransactionContext,
  sessionId: string,
  participants: RoundCommandAuthority['participants'],
) {
  const revoked = participants
    .filter((seat) => seat.kind === 'human' && !seat.eligible)
    .map((seat) => seat.id);
  if (!revoked.length) return [];
  const bound = await tx
    .select({ seat: mediaParticipants.roundParticipantId })
    .from(mediaParticipants)
    .where(
      and(
        eq(mediaParticipants.sessionId, sessionId),
        inArray(mediaParticipants.roundParticipantId, revoked),
      ),
    );
  return bound.map(({ seat }) => seat);
}

/**
 * Moves the session to a fresh LiveKit room: drops the given revoked seats, fences the
 * worker lease and returns the next room name. Called once the pass's room fate says to.
 */
export async function rotateMediaRoom(
  tx: BoundedTransactionContext,
  sessionId: string,
  revoked: readonly string[],
  now: Date,
  nextId: () => string,
) {
  if (revoked.length)
    await tx
      .delete(mediaParticipants)
      .where(
        and(
          eq(mediaParticipants.sessionId, sessionId),
          inArray(mediaParticipants.roundParticipantId, [...revoked]),
        ),
      );
  await tx
    .update(mediaWorkerLeases)
    .set({
      epoch: sql`${mediaWorkerLeases.epoch} + 1`,
      expiresAt: now,
    })
    .where(eq(mediaWorkerLeases.sessionId, sessionId));
  return mediaId(nextId());
}
