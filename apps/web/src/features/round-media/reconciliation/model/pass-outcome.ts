import type { MediaObservation } from '@daisy/debate-engine';
import type { MediaRoomRead } from '@daisy/protocol/media-room-fate';
import type { MediaSnapshot } from '../../projection';
import type { Store } from '../../operation-context';

type AbsenceProof = Awaited<ReturnType<Store['prepareMediaAbsenceProof']>>;
type RoomEvidence = {
  readonly vendor: MediaRoomRead;
  readonly observation: MediaObservation;
};
type SnapshotEvidence = {
  readonly kind: 'snapshot';
  readonly state: MediaSnapshot;
};
type ReadEvidence = {
  readonly kind: 'room';
  readonly state: MediaSnapshot;
  readonly read: RoomEvidence;
};
type OccupiedEvidence = ReadEvidence & {
  readonly read: RoomEvidence & {
    readonly vendor: Extract<MediaRoomRead, { kind: 'read' }> & {
      readonly empty: false;
    };
  };
};
type Evidence = { readonly kind: 'unread' } | SnapshotEvidence | ReadEvidence;
type CleanupResult =
  | { readonly kind: 'pending' }
  | { readonly kind: 'finished'; readonly proof: AbsenceProof | null };
type NoCleanup = { readonly kind: 'none' };
type InitialCleanup = {
  readonly kind: 'initial';
  readonly result: CleanupResult;
};
type ClosingCleanup = {
  readonly kind: 'closing';
  readonly result: CleanupResult;
};
type Cleanup = NoCleanup | InitialCleanup | ClosingCleanup;
export type HeldOutcome =
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'failed'; readonly error: unknown };
export type RoomReconcileOutcome =
  | { readonly refused: unknown }
  | { readonly settled: boolean }
  | { readonly lost: true };
type Facts<E extends Evidence, C extends Cleanup> = {
  readonly evidence: E;
  readonly cleanup: C;
};
type ReadingPass =
  | (Facts<{ readonly kind: 'unread' }, NoCleanup> & {
      readonly kind: 'pending';
    })
  | (Facts<SnapshotEvidence, NoCleanup> & { readonly kind: 'snapshot' })
  | (Facts<ReadEvidence, NoCleanup> & { readonly kind: 'room' });
type RoomPass =
  | (Facts<OccupiedEvidence, NoCleanup | ClosingCleanup> & {
      readonly kind: 'occupied-call';
    })
  | (Facts<ReadEvidence, NoCleanup | ClosingCleanup> & {
      readonly kind: 'reconciled';
      readonly writes: 'acknowledged' | 'unacknowledged';
      readonly held: { readonly kind: 'pending' } | HeldOutcome;
    })
  | (Facts<ReadEvidence, NoCleanup | ClosingCleanup> & {
      readonly kind: 'lost';
    })
  | (Facts<ReadEvidence, NoCleanup | ClosingCleanup> & {
      readonly kind: 'admission-refused';
      readonly error: unknown;
    });
type EndedPass =
  | (Facts<SnapshotEvidence | ReadEvidence, InitialCleanup> & {
      readonly kind: 'cleanup';
    })
  | RoomPass
  | (Facts<Evidence, Cleanup> & { readonly kind: 'race' })
  | (Facts<Evidence, Cleanup> & {
      readonly kind: 'deferred';
      readonly error: unknown;
    });
/** The read phases own their prerequisites; terminal faults cannot accept later body results. */
type MediaPass = ReadingPass | EndedPass;
type PassEvent =
  | { readonly type: 'snapshot'; readonly state: MediaSnapshot }
  | { readonly type: 'room-read'; readonly read: RoomEvidence }
  | { readonly type: 'cleanup-started'; readonly phase: 'initial' | 'closing' }
  | { readonly type: 'cleanup-completed'; readonly proof: AbsenceProof | null }
  | { readonly type: 'occupied-call' }
  | { readonly type: 'room-result'; readonly result: RoomReconcileOutcome }
  | { readonly type: 'held-result'; readonly result: HeldOutcome }
  | {
      readonly type: 'pass-failed';
      readonly error: unknown;
      readonly expected: boolean;
    }
  | { readonly type: 'closing-failed'; readonly error: unknown };
export const initialMediaPass = (): MediaPass => ({
  kind: 'pending',
  evidence: { kind: 'unread' },
  cleanup: { kind: 'none' },
});
const isEnded = (outcome: MediaPass): outcome is EndedPass =>
  outcome.kind !== 'pending' &&
  outcome.kind !== 'snapshot' &&
  outcome.kind !== 'room';
const occupied = (evidence: ReadEvidence): evidence is OccupiedEvidence =>
  evidence.read.vendor.kind === 'read' && !evidence.read.vendor.empty;
const callbackPending = (outcome: MediaPass) =>
  outcome.kind === 'reconciled' && outcome.held.kind === 'pending';
export function nextMediaPass(outcome: MediaPass, event: PassEvent): MediaPass {
  switch (event.type) {
    case 'snapshot':
      return outcome.kind === 'pending'
        ? {
            kind: 'snapshot',
            evidence: { kind: 'snapshot', state: event.state },
            cleanup: outcome.cleanup,
          }
        : outcome;
    case 'room-read':
      return outcome.kind === 'snapshot'
        ? {
            kind: 'room',
            evidence: {
              kind: 'room',
              state: outcome.evidence.state,
              read: event.read,
            },
            cleanup: outcome.cleanup,
          }
        : outcome;
    case 'cleanup-started':
      if (event.phase === 'initial')
        return outcome.kind === 'snapshot' || outcome.kind === 'room'
          ? {
              kind: 'cleanup',
              evidence: outcome.evidence,
              cleanup: { kind: 'initial', result: { kind: 'pending' } },
            }
          : outcome;
      if (
        !isEnded(outcome) ||
        outcome.kind === 'cleanup' ||
        outcome.cleanup.kind !== 'none' ||
        callbackPending(outcome)
      )
        return outcome;
      return {
        ...outcome,
        cleanup: { kind: 'closing', result: { kind: 'pending' } },
      };
    case 'cleanup-completed':
      if (
        outcome.kind === 'cleanup' &&
        outcome.cleanup.result.kind === 'pending'
      )
        return {
          ...outcome,
          cleanup: {
            kind: 'initial',
            result: { kind: 'finished', proof: event.proof },
          },
        };
      if (
        isEnded(outcome) &&
        outcome.kind !== 'cleanup' &&
        outcome.cleanup.kind === 'closing' &&
        outcome.cleanup.result.kind === 'pending'
      )
        return {
          ...outcome,
          cleanup: {
            kind: 'closing',
            result: { kind: 'finished', proof: event.proof },
          },
        };
      return outcome;
    case 'occupied-call':
      return outcome.kind === 'room' && occupied(outcome.evidence)
        ? {
            kind: 'occupied-call',
            evidence: outcome.evidence,
            cleanup: outcome.cleanup,
          }
        : outcome;
    case 'room-result': {
      if (outcome.kind !== 'room') return outcome;
      const facts = { evidence: outcome.evidence, cleanup: outcome.cleanup };
      if ('refused' in event.result)
        return {
          ...facts,
          kind: 'admission-refused',
          error: event.result.refused,
        };
      if ('lost' in event.result) return { ...facts, kind: 'lost' };
      return {
        ...facts,
        kind: 'reconciled',
        writes: event.result.settled ? 'acknowledged' : 'unacknowledged',
        held: { kind: 'pending' },
      };
    }
    case 'held-result':
      return outcome.kind === 'reconciled' && outcome.held.kind === 'pending'
        ? { ...outcome, held: event.result }
        : outcome;
    case 'pass-failed': {
      if (
        isEnded(outcome) &&
        !(
          outcome.kind === 'cleanup' &&
          outcome.cleanup.result.kind === 'pending'
        )
      )
        return outcome;
      const facts = { evidence: outcome.evidence, cleanup: outcome.cleanup };
      return event.expected
        ? { ...facts, kind: 'race' }
        : { ...facts, kind: 'deferred', error: event.error };
    }
    case 'closing-failed':
      if (!isEnded(outcome) || callbackPending(outcome)) return outcome;
      return {
        kind: 'deferred',
        evidence: outcome.evidence,
        cleanup: outcome.cleanup,
        error: outcome.kind === 'deferred' ? outcome.error : event.error,
      };
  }
}
/** An initial attempt, even one without proof, is not repeated at closing. */
export const initiallyCleaned = (outcome: MediaPass) =>
  outcome.cleanup.kind === 'initial';
const provenCleanup = (cleanup: Cleanup) =>
  cleanup.kind !== 'none' &&
  cleanup.result.kind === 'finished' &&
  cleanup.result.proof !== null;
export const mediaPassCompletion = (outcome: MediaPass) => {
  const workFinished =
    outcome.kind === 'cleanup'
      ? provenCleanup(outcome.cleanup)
      : outcome.kind === 'occupied-call' ||
        (outcome.kind === 'reconciled' &&
          outcome.writes === 'acknowledged' &&
          outcome.held.kind !== 'pending');
  return {
    clean:
      workFinished &&
      (outcome.cleanup.kind === 'none' || provenCleanup(outcome.cleanup)),
    absenceProof:
      outcome.cleanup.kind !== 'none' &&
      outcome.cleanup.result.kind === 'finished'
        ? outcome.cleanup.result.proof
        : null,
    seen:
      outcome.evidence.kind === 'room' ? outcome.evidence.read.vendor : null,
  };
};
/** Only an actual fault before any room read means unreachable. A refusal claims nothing. */
export const mediaPassObservation = (
  outcome: MediaPass,
): {
  readonly state: MediaSnapshot;
  readonly observation: MediaObservation;
} | null =>
  outcome.evidence.kind === 'unread'
    ? null
    : {
        state: outcome.evidence.state,
        observation:
          outcome.evidence.kind === 'room'
            ? outcome.evidence.read.observation
            : {
                kind:
                  outcome.kind === 'deferred' && !initiallyCleaned(outcome)
                    ? 'unreachable'
                    : 'unread',
              },
      };
/** Finish/incident-hook exceptions escape at the edge before this selection. */
export function mediaPassReply(
  outcome: MediaPass,
):
  | { readonly kind: 'defer'; readonly error: unknown }
  | { readonly kind: 'held-failed'; readonly error: unknown }
  | { readonly kind: 'return'; readonly refusal: unknown } {
  if (outcome.kind === 'deferred')
    return { kind: 'defer', error: outcome.error };
  if (outcome.kind === 'reconciled' && outcome.held.kind === 'failed')
    return { kind: 'held-failed', error: outcome.held.error };
  return {
    kind: 'return',
    refusal: outcome.kind === 'admission-refused' ? outcome.error : undefined,
  };
}
