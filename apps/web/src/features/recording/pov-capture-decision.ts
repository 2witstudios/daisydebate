import {
  egressPrivacyActions,
  phasePrivateAt,
  runningEgress,
  type StageEgressFact,
  type StagePhaseFact,
  type StagePrivacyAction,
} from '@daisy/debate-engine';
import type { RecordingLifecycle } from '@daisy/protocol';

/** One seat as committed history has it, whether or not it ever reached the room. */
export type PovSeat = {
  readonly roundParticipantId: string;
  readonly role: string;
  readonly kind: string;
};

/**
 * Who gets a POV: the debaters, chosen from the Round's seats and never from a room
 * listing, so a hidden judge cannot be picked up. A bot has a voice and no camera.
 */
export const povSeatsOf = (
  seats: readonly PovSeat[],
): readonly {
  readonly roundParticipantId: string;
  readonly camera: boolean;
}[] =>
  seats.flatMap((seat) =>
    seat.role === 'affirmative' || seat.role === 'negative'
      ? [
          {
            roundParticipantId: seat.roundParticipantId,
            camera: seat.kind === 'human',
          },
        ]
      : [],
  );

export type PovCaptureFacts = {
  readonly nowMs: number;
  readonly lifecycle: RecordingLifecycle;
  readonly roundEnded: boolean;
  readonly phase: StagePhaseFact;
  /** The latest Egress of this debater; null before any has started. */
  readonly egressId: string | null;
  readonly egress: StageEgressFact;
  readonly startedAtMs: number | null;
  readonly observerSubscribed: boolean;
  readonly revocationFailures: number;
  /** This debater is in the room now: an Egress for anyone else would only fail. */
  readonly present: boolean;
};

export type PovCaptureAction =
  | { readonly type: 'start-pov' }
  | { readonly type: 'stop-pov'; readonly id: string }
  | { readonly type: 'close-pov' }
  | Exclude<StagePrivacyAction, { type: 'stop-egress' }>;

/** An Egress that died at once gets this long before the next try, so none spins. */
const RESTART_AFTER_MS = 10_000;
/**
 * How long a finished Recording's build waits for a POV that will not stop. Past it
 * the POV is built from what was held, and the stray sweep goes on stopping the Egress.
 */
const STOP_GRACE_MS = 120_000;

const stopGraceOver = ({ lifecycle, nowMs }: PovCaptureFacts) =>
  lifecycle.status === 'processing' &&
  nowMs - Date.parse(lifecycle.capture.endedAt) >= STOP_GRACE_MS;

const whenFinished = (facts: PovCaptureFacts): readonly PovCaptureAction[] => {
  const live = runningEgress(facts.egress);
  if (!live) return [{ type: 'close-pov' }];
  return [
    { type: 'stop-pov', id: live.id },
    ...(stopGraceOver(facts) ? [{ type: 'close-pov' as const }] : []),
  ];
};

const mayStart = (facts: PovCaptureFacts) =>
  facts.present &&
  (facts.startedAtMs === null ||
    facts.nowMs - facts.startedAtMs >= RESTART_AFTER_MS);

/**
 * What one debater's capture does next, from observed facts alone. Pure and total. It
 * runs only while the Recording captures, and starts only in public, under the one
 * privacy rule every Egress in a Round's room obeys.
 */
export const decidePovCapture = (
  facts: PovCaptureFacts,
): readonly PovCaptureAction[] => {
  if (facts.lifecycle.status !== 'capturing' || facts.roundEnded)
    return whenFinished(facts);
  const live = runningEgress(facts.egress);
  if (!live && !phasePrivateAt(facts.phase, facts.nowMs))
    return mayStart(facts) ? [{ type: 'start-pov' }] : [];
  if (facts.egressId === null) return [];
  return egressPrivacyActions(facts).map((action) =>
    action.type === 'stop-egress'
      ? { type: 'stop-pov', id: action.id }
      : action,
  );
};
