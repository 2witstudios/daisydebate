import { createAppError } from '@daisy/errors';
import { and, eq } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { mediaId } from './media-session-authority';
import { mediaParticipants, mediaSessions } from './schema/media-sessions';

export const mediaBindingFields = {
  sessionId: mediaSessions.id,
  roomName: mediaSessions.roomName,
  roundId: mediaSessions.roundId,
  roundParticipantId: mediaParticipants.roundParticipantId,
  identity: mediaParticipants.identity,
};

/** Caller already holds canonical account and Round fences; session comes last. */
export async function bindMediaParticipant(
  tx: BoundedTransactionContext,
  input: {
    readonly roundId: string;
    readonly roundParticipantId: string;
    readonly nextId: () => string;
  },
) {
  await tx
    .insert(mediaSessions)
    .values({
      id: mediaId(input.nextId()),
      roundId: input.roundId,
      roomName: mediaId(input.nextId()),
    })
    .onConflictDoNothing({ target: mediaSessions.roundId });
  const [session] = await tx
    .select()
    .from(mediaSessions)
    .where(eq(mediaSessions.roundId, input.roundId))
    .for('update');
  if (!session || session.endedAt)
    throw createAppError('CONFLICT', 'Round media has ended');
  await tx
    .insert(mediaParticipants)
    .values({
      id: mediaId(input.nextId()),
      sessionId: session.id,
      roundId: input.roundId,
      roundParticipantId: input.roundParticipantId,
      identity: mediaId(input.nextId()),
    })
    .onConflictDoNothing({
      target: [
        mediaParticipants.sessionId,
        mediaParticipants.roundParticipantId,
      ],
    });
  const [binding] = await tx
    .select(mediaBindingFields)
    .from(mediaSessions)
    .innerJoin(
      mediaParticipants,
      eq(mediaParticipants.sessionId, mediaSessions.id),
    )
    .where(
      and(
        eq(mediaSessions.id, session.id),
        eq(mediaParticipants.roundParticipantId, input.roundParticipantId),
      ),
    );
  if (!binding) throw createAppError('INTERNAL');
  return binding;
}
