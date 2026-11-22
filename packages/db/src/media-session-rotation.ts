import { and, eq, inArray, sql } from 'drizzle-orm';
import { mediaBindingRevoked } from '@daisy/protocol/media-binding-authority';
import { type RoundCommandAuthority } from '@daisy/protocol/round-command';
import { mediaId } from './media-session-authority';
import { mediaParticipants } from './schema/media-sessions';
import { mediaWorkerLeases } from './schema/transcript-segments';
import type { Tx } from './tx';

/** Bound human seats that have lost their place, by round participant. */
export async function revokedBoundSeats(
  tx: Tx,
  sessionId: string,
  participants: RoundCommandAuthority['participants'],
) {
  const bound = await tx
    .select({ seat: mediaParticipants.roundParticipantId })
    .from(mediaParticipants)
    .where(eq(mediaParticipants.sessionId, sessionId));
  return bound
    .filter(({ seat }) => mediaBindingRevoked(participants, seat))
    .map(({ seat }) => seat);
}

/**
 * Moves the session to a fresh LiveKit room: drops the given revoked seats, fences the
 * worker lease and returns the next room name. Called once the pass's room fate says to.
 */
export async function rotateMediaRoom(
  tx: Tx,
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
