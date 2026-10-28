import {
  bindMediaParticipant,
  mediaBindingFields as bindingFields,
} from './media-participant-binding';
import {
  verifyBotMediaPrincipal,
  verifyLockedBotWorker,
  type BotMediaPrincipal,
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
      readonly principal: BotMediaPrincipal;
      readonly buildProjection: LockedRoundTickInput['buildProjection'];
    }) {
      const { scope, token } = input.principal;
      return run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
        const binding = await bindMediaParticipant(tx, {
          roundId: scope.roundId,
          roundParticipantId: scope.roundParticipantId,
          nextId,
        });
        const tick = await executeLockedRoundTick(tx, {
          roundId: scope.roundId,
          buildProjection: input.buildProjection,
        });
        // The tick may have moved the segment or the claim, so the whole
        // admission rule (claim included) is judged again after it, the same
        // one the token is signed under; a refusal rolls the binding back
        // with this transaction. The claim check before it only spares a
        // dead claim the tick.
        await verifyBotMediaPrincipal(tx, input.principal);
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
