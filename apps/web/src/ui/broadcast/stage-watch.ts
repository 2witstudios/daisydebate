/** About as long as the heartbeat may go stale, so the two ways agree on what is gone. */
const FAILING_LIMIT_MS = 10_000;
/** The route's way to say the control plane is gone, to this credential alone. */
const ENDS_NOW = 410;

export type StageWatch =
  | { readonly ended: false; readonly failingSinceMs: number | null }
  | { readonly ended: true };

export const stageWatchStart: StageWatch = {
  ended: false,
  failingSinceMs: null,
};

/**
 * Whether the stage must end its own Egress, from each read's answer; null means no
 * answer at all. One refusal on a stale heartbeat ends it. Anything else that is not
 * good only counts: a blip passes, and a stage whose web tier is gone cannot be told.
 */
export const watchedStage = (
  watch: StageWatch,
  status: number | null,
  nowMs: number,
): StageWatch => {
  if (watch.ended || status === ENDS_NOW) return { ended: true };
  if (status !== null && status >= 200 && status < 300) return stageWatchStart;
  const failingSinceMs = watch.failingSinceMs ?? nowMs;
  return nowMs - failingSinceMs >= FAILING_LIMIT_MS
    ? { ended: true }
    : { ended: false, failingSinceMs };
};
