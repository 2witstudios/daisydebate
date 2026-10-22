import { createAppError } from '@daisy/errors';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransaction } from './bounded-transaction';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import {
  lockMediaRound,
  mediaId as parseId,
  requireMediaWindow,
} from './media-session-authority';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaParticipants, mediaSessions } from './schema/media-sessions';
import { rounds } from './schema/rounds';

const bindingFields = {
  sessionId: mediaSessions.id,
  roomName: mediaSessions.roomName,
  roundId: mediaSessions.roundId,
  roundParticipantId: mediaParticipants.roundParticipantId,
  identity: mediaParticipants.identity,
};

/** One application SQL pool and its bounded transaction runner; no owned connection lifecycle. */
export function createMediaSessionStore({
  database,
  run,
  nextId,
}: {
  readonly database: BunSQLDatabase;
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    async ensureBinding(input: {
      readonly roundId: string;
      readonly actorId: string;
      readonly buildProjection: LockedRoundTickInput['buildProjection'];
    }) {
      const roundId = parseId(input.roundId);
      const actorId = parseId(input.actorId);
      return run(async (tx) => {
        const authority = await lockMediaRound(tx, roundId, actorId);
        const roundParticipantId = authority.caller!.id;
        const [current] = await tx
          .select({
            status: rounds.status,
            finalSegmentEndedAt: rounds.finalSegmentEndedAt,
          })
          .from(rounds)
          .where(eq(rounds.id, roundId));
        requireMediaWindow(
          current!.status,
          await sampleRoundExecutionTime(tx),
          current!.finalSegmentEndedAt?.toISOString() ?? null,
        );
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
        const tick = await executeLockedRoundTick(tx, {
          roundId,
          buildProjection: input.buildProjection,
        });
        requireMediaWindow(current!.status, tick.now, tick.finalSegmentEndedAt);
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
  };
}
