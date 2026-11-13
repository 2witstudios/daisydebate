import {
  isRoundCompleted,
  postRoundCallPolicy,
  type RoundView,
} from '@daisy/protocol';

type CallView = Pick<RoundView, 'status' | 'postRoundCall' | 'completedAt'>;

/** A completed Round whose host chose the post-round call (ADR 0127). */
export const postRoundCallChosen = (view: CallView): boolean =>
  isRoundCompleted(view.status) && view.postRoundCall;

/** The latest instant the call can last to, or null for a Round with no call. */
export const postRoundCallEndsAtMs = (view: CallView): number | null =>
  postRoundCallChosen(view) && view.completedAt !== null
    ? Date.parse(view.completedAt) + postRoundCallPolicy.maxMs
    : null;

/**
 * Whether a room should stay on screen for the call at `nowMs`. The server
 * alone decides whether media is still open: it ends the call early once
 * everyone has left, and the media session then says so.
 */
export const postRoundCallOffered = (
  view: CallView,
  nowMs: number,
): boolean => {
  const endsAtMs = postRoundCallEndsAtMs(view);
  return endsAtMs !== null && nowMs < endsAtMs;
};
