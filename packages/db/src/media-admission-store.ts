import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockedMediaSnapshot,
  type MediaSessionSnapshot,
  type MediaSessionRead,
} from './media-session-snapshot';
import { requireMediaWindow } from './media-session-authority';
import type { BoundedTransactionContext } from './transaction-context';
import type { LockedRoundTickInput } from './round-clock-transaction';
import {
  verifyLockedBotWorker,
  requireBotSpeakingWindow,
  type BotPublicationScope,
} from './bot-publication-context';

export type MediaAdmissionPrincipal =
  | { readonly kind: 'human'; readonly actorId: string }
  | {
      readonly kind: 'bot';
      readonly scope: BotPublicationScope;
      readonly token: string;
    };
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
    readonly buildProjection: LockedRoundTickInput['buildProjection'];
    /** Local cryptographic signing only: no provider/network I/O in this callback. */
    readonly sign: (context: MediaAdmissionContext) => Promise<T>;
  }) {
    return run(async (tx) => {
      let snapshot = await requiredSnapshot(tx, {
        roundId: input.roundId,
        ...(input.principal.kind === 'human'
          ? { actorId: input.principal.actorId }
          : {}),
        buildProjection: input.buildProjection,
      });
      let participantId: string;
      if (input.principal.kind === 'bot') {
        if (input.principal.scope.roundId !== input.roundId)
          throw createAppError('AUTHORIZATION');
        await verifyLockedBotWorker(
          tx,
          input.principal.scope,
          input.principal.token,
        );
        await requireBotSpeakingWindow(tx, input.principal.scope);
        // Run/claim locks can wait. Re-tick at the actual post-lock instant before signing.
        snapshot = await requiredSnapshot(tx, {
          roundId: input.roundId,
          buildProjection: input.buildProjection,
        });
        await verifyLockedBotWorker(
          tx,
          input.principal.scope,
          input.principal.token,
        );
        await requireBotSpeakingWindow(tx, input.principal.scope);
        participantId = input.principal.scope.roundParticipantId;
      } else participantId = snapshot.caller!.id;
      const binding = snapshot.bindings.find(
        (binding) => binding.roundParticipantId === participantId,
      );
      if (!binding) throw createAppError('AUTHORIZATION');
      requireMediaWindow(
        snapshot.round.status,
        snapshot.now,
        snapshot.finalSegmentEndedAt,
      );
      if (
        snapshot.session.endedAt ||
        snapshot.session.unsafeAt ||
        snapshot.unresolved ||
        snapshot.reconciling
      )
        throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
      return input.sign({ ...snapshot, participantId, binding });
    });
  },
});
