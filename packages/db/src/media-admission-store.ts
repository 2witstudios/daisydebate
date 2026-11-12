import { createAppError } from '@daisy/errors';
import { eq } from 'drizzle-orm';
import { mediaSessions } from './schema/media-sessions';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockedMediaSnapshot,
  type MediaSessionSnapshot,
  type MediaSessionRead,
} from './media-session-snapshot';
import {
  requireMediaWindow,
  type MediaWindowRule,
} from './media-session-authority';
import type { ParticipantAdmission } from './participant-admission';
import type { BoundedTransactionContext } from './transaction-context';
import type { LockedRoundTickInput } from './round-clock-transaction';
import {
  verifyBotMediaPrincipal,
  type BotMediaPrincipal,
} from './bot-publication-context';

export type MediaAdmissionPrincipal =
  | {
      readonly kind: 'human';
      readonly actorId: string;
    }
  | BotMediaPrincipal;
export type MediaAdmissionContext = MediaSessionSnapshot & {
  readonly binding: MediaSessionSnapshot['bindings'][number];
  readonly participantId: string;
};
const requiredSnapshot = async (
  tx: BoundedTransactionContext,
  input: MediaSessionRead,
) => {
  const snapshot = await lockedMediaSnapshot(tx, input);
  if (!snapshot) throw createAppError('NOT_FOUND');
  return snapshot;
};
export const createMediaAdmissionStore = (run: BoundedTransaction) => ({
  async issueMediaToken<T>(input: {
    readonly roundId: string;
    readonly principal: MediaAdmissionPrincipal;
    /** ADR 0075: participant access, for the human caller and every human seat. */
    readonly admits: ParticipantAdmission;
    readonly buildProjection: LockedRoundTickInput['buildProjection'];
    readonly mediaPhase: MediaWindowRule;
    /**
     * The reconcile lease owner the caller holds, if any. A live lease
     * refuses the token unless it is the caller's own (ISSUE-534).
     */
    readonly reconcileOwner?: string;
    /** Local cryptographic signing only: no provider/network I/O in this callback. */
    readonly sign: (context: MediaAdmissionContext) => Promise<T>;
  }) {
    return run(async (tx) => {
      let snapshot = await requiredSnapshot(tx, {
        roundId: input.roundId,
        admits: input.admits,
        ...(input.principal.kind === 'human'
          ? { actorId: input.principal.actorId }
          : {}),
        buildProjection: input.buildProjection,
      });
      let participantId: string;
      if (input.principal.kind === 'bot') {
        if (input.principal.scope.roundId !== input.roundId)
          throw createAppError('AUTHORIZATION');
        await verifyBotMediaPrincipal(tx, input.principal);
        // Run/claim locks can wait. Re-tick at the actual post-lock instant before signing.
        snapshot = await requiredSnapshot(tx, {
          roundId: input.roundId,
          admits: input.admits,
          buildProjection: input.buildProjection,
        });
        await verifyBotMediaPrincipal(tx, input.principal);
        participantId = input.principal.scope.roundParticipantId;
      } else participantId = snapshot.caller!.id;
      const binding = snapshot.bindings.find(
        (binding) => binding.roundParticipantId === participantId,
      );
      if (!binding) throw createAppError('AUTHORIZATION');
      const phase = requireMediaWindow(input.mediaPhase, snapshot.mediaWindow);
      // A bot speaks only in its Round: it is never on a post-round call.
      if (input.principal.kind === 'bot' && phase !== 'round')
        throw createAppError('CONFLICT', 'Round media has ended');
      if (
        snapshot.session.endedAt ||
        snapshot.session.unsafeAt ||
        snapshot.unresolved ||
        (snapshot.reconciling &&
          snapshot.session.reconcileOwner !== input.reconcileOwner)
      )
        throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
      const signed = await input.sign({ ...snapshot, participantId, binding });
      // Someone is on their way into the call's room: an emptiness measured
      // before them must not close it on them. Only a later read of an empty
      // room starts the grace again (ADR 0126).
      if (phase === 'post-round-call' && snapshot.session.roomVacantSince)
        await tx
          .update(mediaSessions)
          .set({ roomVacantSince: null })
          .where(eq(mediaSessions.id, snapshot.session.id));
      return signed;
    });
  },
});
