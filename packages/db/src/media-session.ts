import { SQL } from 'bun';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { mediaParticipants, mediaSessions } from './schema/media-sessions';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';

const bindingFields = {
  sessionId: mediaSessions.id,
  roomName: mediaSessions.roomName,
  roundId: mediaSessions.roundId,
  roundParticipantId: mediaParticipants.roundParticipantId,
  identity: mediaParticipants.identity,
};

const parseId = (value: string) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success)
    throw createAppError('VALIDATION', 'Invalid media identifier');
  return parsed.data;
};

/** Persistence only: callers supply fresh authorization before requesting admission. */
export function createMediaSessionStore({
  url,
  nextId,
}: {
  readonly url: string;
  readonly nextId: () => string;
}) {
  const client = new SQL(url);
  const database = drizzle({ client });
  return {
    async ensureBinding(input: {
      readonly roundId: string;
      readonly roundParticipantId: string;
    }) {
      const roundId = parseId(input.roundId);
      const roundParticipantId = parseId(input.roundParticipantId);
      return database.transaction(async (tx) => {
        // The Round lock also serializes admission against terminal competitive commits.
        const [round] = await tx
          .select({ status: rounds.status })
          .from(rounds)
          .where(eq(rounds.id, roundId))
          .for('update');
        if (!round) throw createAppError('NOT_FOUND', 'No such Round');
        if (round.status === 'completed' || round.status === 'abandoned')
          throw createAppError('CONFLICT', 'Round media has ended');
        const [seat] = await tx
          .select({ id: roundParticipants.id })
          .from(roundParticipants)
          .where(
            and(
              eq(roundParticipants.id, roundParticipantId),
              eq(roundParticipants.roundId, roundId),
            ),
          );
        if (!seat) throw createAppError('NOT_FOUND', 'No such Round seat');
        await tx
          .insert(mediaSessions)
          .values({
            id: parseId(nextId()),
            roundId,
            roomName: parseId(nextId()),
          })
          .onConflictDoNothing({ target: mediaSessions.roundId });
        const [session] = await tx
          .select()
          .from(mediaSessions)
          .where(eq(mediaSessions.roundId, roundId))
          .for('update');
        if (!session || session.endedAt)
          throw createAppError('CONFLICT', 'Round media has ended');
        await tx
          .insert(mediaParticipants)
          .values({
            id: parseId(nextId()),
            sessionId: session.id,
            roundId,
            roundParticipantId,
            identity: parseId(nextId()),
          })
          .onConflictDoNothing({
            target: [
              mediaParticipants.sessionId,
              mediaParticipants.roundParticipantId,
            ],
          });
        const [binding] = await tx
          .select(bindingFields)
          .from(mediaSessions)
          .innerJoin(
            mediaParticipants,
            eq(mediaParticipants.sessionId, mediaSessions.id),
          )
          .where(
            and(
              eq(mediaSessions.id, session.id),
              eq(mediaParticipants.roundParticipantId, roundParticipantId),
            ),
          );
        if (!binding) throw createAppError('INTERNAL', 'Media binding missing');
        return binding;
      });
    },
    async findBinding(input: {
      readonly sessionId: string;
      readonly identity: string;
    }) {
      const [binding] = await database
        .select(bindingFields)
        .from(mediaSessions)
        .innerJoin(
          mediaParticipants,
          eq(mediaParticipants.sessionId, mediaSessions.id),
        )
        .where(
          and(
            eq(mediaSessions.id, parseId(input.sessionId)),
            eq(mediaParticipants.identity, parseId(input.identity)),
          ),
        );
      return binding ?? null;
    },
    close: () => client.close(),
  };
}
