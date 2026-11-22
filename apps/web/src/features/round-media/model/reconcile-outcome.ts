import type { MediaObservation } from '@daisy/debate-engine';
import type { MediaRoomRead } from '@daisy/protocol/media-room-fate';
import type { MediaSnapshot } from '../projection';
import type { Store } from '../operation-context';

type AbsenceProof = Awaited<ReturnType<Store['prepareMediaAbsenceProof']>>;
type RoomEvidence = {
  readonly vendor: MediaRoomRead;
  readonly observation: MediaObservation;
};
type Evidence =
  | { readonly kind: 'unread' }
  | { readonly kind: 'snapshot'; readonly state: MediaSnapshot }
  | {
      readonly kind: 'room';
      readonly state: MediaSnapshot;
      readonly read: RoomEvidence;
    };
type Cleanup =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'initial' | 'closing';
      readonly proof: AbsenceProof | null;
    };
export type HeldOutcome =
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'failed'; readonly error: unknown };
export type RoomReconcileOutcome =
  | { readonly refused: unknown }
  | { readonly settled: boolean }
  | { readonly lost: true };
/** Evidence is separate from the exclusive reason this pass ended. No callback can coexist with an own refusal or a pass fault. */
type MediaPass = { readonly evidence: Evidence; readonly cleanup: Cleanup } & (
  | { readonly kind: 'pending' | 'cleanup' | 'occupied-call' | 'lost' | 'race' }
  | {
      readonly kind: 'reconciled';
      readonly writes: 'acknowledged' | 'unacknowledged';
      readonly held: HeldOutcome;
    }
  | { readonly kind: 'admission-refused' | 'deferred'; readonly error: unknown }
);
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
export function nextMediaPass(outcome: MediaPass, event: PassEvent): MediaPass {
  const facts = { evidence: outcome.evidence, cleanup: outcome.cleanup };
  switch (event.type) {
    case 'snapshot':
      return { ...outcome, evidence: { kind: 'snapshot', state: event.state } };
    case 'room-read':
      return outcome.evidence.kind === 'unread'
        ? outcome
        : {
            ...outcome,
            evidence: {
              kind: 'room',
              state: outcome.evidence.state,
              read: event.read,
            },
          };
    case 'cleanup-started':
      return event.phase === 'initial'
        ? {
            ...facts,
            kind: 'cleanup',
            cleanup: { kind: 'initial', proof: null },
          }
        : { ...outcome, cleanup: { kind: 'closing', proof: null } };
    case 'cleanup-completed':
      return outcome.cleanup.kind === 'none'
        ? outcome
        : { ...outcome, cleanup: { ...outcome.cleanup, proof: event.proof } };
    case 'occupied-call':
      return { ...facts, kind: 'occupied-call' };
    case 'room-result': {
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
        held: { kind: 'succeeded' },
      };
    }
    case 'held-result':
      return outcome.kind === 'reconciled'
        ? { ...outcome, held: event.result }
        : outcome;
    case 'pass-failed':
      return event.expected
        ? { ...facts, kind: 'race' }
        : { ...facts, kind: 'deferred', error: event.error };
    case 'closing-failed':
      return {
        ...facts,
        kind: 'deferred',
        error: outcome.kind === 'deferred' ? outcome.error : event.error,
      };
  }
}
/** Initial cleanup is never repeated by the closing uncertainty check. */
export const initiallyCleaned = (outcome: MediaPass) =>
  outcome.cleanup.kind === 'initial';
export const mediaPassCompletion = (outcome: MediaPass) => {
  const workFinished =
    outcome.kind === 'cleanup' ||
    outcome.kind === 'occupied-call' ||
    (outcome.kind === 'reconciled' && outcome.writes === 'acknowledged');
  return {
    clean:
      workFinished &&
      (outcome.cleanup.kind === 'none' || outcome.cleanup.proof !== null),
    absenceProof:
      outcome.cleanup.kind === 'none' ? null : outcome.cleanup.proof,
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
/** Finish/incident-hook exceptions remain at the I/O edge and escape before this selection. */
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
