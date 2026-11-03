import { roundMediaPolicy } from '@daisy/protocol';

/** The instant shared media closes, from the final segment's end. */
export const mediaWindowEndsAt = (finalSegmentEndedAt: string) =>
  Date.parse(finalSegmentEndedAt) + roundMediaPolicy.windowAfterFinalSegmentMs;

/** The one decision: a finished Round, or the window past its final segment, has no media. */
export const mediaWindowClosed = (
  status: string,
  now: string,
  finalSegmentEndedAt: string | null,
) =>
  !['opening', 'active'].includes(status) ||
  (finalSegmentEndedAt !== null &&
    Date.parse(now) >= mediaWindowEndsAt(finalSegmentEndedAt));
