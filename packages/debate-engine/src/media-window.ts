import {
  isRoundRunning,
  roundMediaPolicy,
  type MediaPhase,
  type MediaWindowFacts,
} from '@daisy/protocol';
import { postRoundCallState } from './post-round-call';

/** The instant shared media closes, from the final segment's end. */
export const mediaWindowEndsAt = (finalSegmentEndedAt: string) =>
  Date.parse(finalSegmentEndedAt) + roundMediaPolicy.windowAfterFinalSegmentMs;

const callPhase = {
  none: 'closed',
  over: 'closed',
  opening: 'post-round-call-opening',
  open: 'post-round-call',
} as const satisfies Record<string, MediaPhase>;

/**
 * The one decision. A running Round has media until the window past its final
 * segment; a finished one has it only as a post-round call (ADR 0127).
 */
export const mediaPhase = (facts: MediaWindowFacts): MediaPhase => {
  if (isRoundRunning(facts.status))
    return facts.finalSegmentEndedAt !== null &&
      Date.parse(facts.now) >= mediaWindowEndsAt(facts.finalSegmentEndedAt)
      ? 'closed'
      : 'round';
  return callPhase[postRoundCallState(facts.postRoundCall, facts.now).kind];
};

/** No media at all: nothing is granted and the room should be gone for good. */
export const mediaWindowClosed = (facts: MediaWindowFacts) =>
  mediaPhase(facts) === 'closed';
