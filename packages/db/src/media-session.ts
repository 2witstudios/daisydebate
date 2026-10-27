import {
  bindMediaParticipant,
  mediaBindingFields as bindingFields,
} from './media-participant-binding';
import {
  verifyLockedBotWorker,
  requireBotSpeakingWindow,
  type BotPublicationScope,
} from './bot-publication-context';
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
  type MediaCaller,
} from './media-session-authority';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaParticipants, mediaSessions } from './schema/media-sessions';
import { rounds } from './schema/rounds';
import { createMediaReconcileStore } from './media-reconcile-store';
import {
  lockedMediaSnapshot,
  type MediaSessionRead,
} from './media-session-snapshot';
import { createMediaAdmissionStore } from './media-admission-store';

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
    ...createMediaReconcileStore({ database, run, nextId }),
    ...createMediaAdmissionStore(run),
    readMediaSession: (input: MediaSessionRead) =>
      run((tx) => lockedMediaSnapshot(tx, input)),
    async ensureBinding(input: {
      readonly roundId: string;
      readonly caller: MediaCaller;
      readonly buildProjection: LockedRoundTickInput['buildProjection'];
    }) {
      const roundId = parseId(input.roundId);
      const actorId = parseId(input.caller.actorId);
      return run(async (tx) => {
        const authority = await lockMediaRound(tx, roundId, input.caller);
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
        const binding = await bindMediaParticipant(tx, {
          roundId,
          roundParticipantId,
          nextId,
        });
        const tick = await executeLockedRoundTick(tx, {
          roundId,
          buildProjection: input.buildProjection,
        });
        requireMediaWindow(current!.status, tick.now, tick.finalSegmentEndedAt);
        return binding;
      });
    },
    async ensureBotBinding(input: {
      readonly scope: BotPublicationScope;
      readonly token: string;
      readonly buildProjection: LockedRoundTickInput['buildProjection'];
    }) {
      return run(async (tx) => {
        await verifyLockedBotWorker(tx, input.scope, input.token);
        const binding = await bindMediaParticipant(tx, {
          roundId: input.scope.roundId,
          roundParticipantId: input.scope.roundParticipantId,
          nextId,
        });
        const tick = await executeLockedRoundTick(tx, {
          roundId: input.scope.roundId,
          buildProjection: input.buildProjection,
        });
        await verifyLockedBotWorker(tx, input.scope, input.token);
        await requireBotSpeakingWindow(tx, input.scope);
        requireMediaWindow('active', tick.now, tick.finalSegmentEndedAt);
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
