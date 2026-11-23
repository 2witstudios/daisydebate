import { afterMs, type Waits } from '@daisy/clock';

/** An asking seat presses its question after this much silence from its peers. */
const UNANSWERED_AFTER_MS = 8000;

/**
 * The two times a speaker wakes by itself rather than on a pulse: when the
 * pause after a setback is over, and once the asking seat's question has met
 * silence for long enough. It only keeps time: whether a turn is paused, and
 * for how long, is the duty's to say.
 */
export function createSelfWake(input: {
  readonly waits: Waits;
  /** The pause after a setback is over. */
  readonly resume: () => void;
  /** The question has met silence for long enough. */
  readonly unanswered: () => void;
}) {
  let cancelPause: (() => void) | null = null;
  let cancelReply: (() => void) | null = null;
  const stopPause = () => {
    cancelPause?.();
    cancelPause = null;
  };
  const stopAwaitingReply = () => {
    cancelReply?.();
    cancelReply = null;
  };
  return {
    /** Resumes after `ms`; a pause already running is replaced. */
    pauseFor(ms: number) {
      stopPause();
      const cancel = afterMs(input.waits, ms, () => {
        if (cancelPause !== cancel) return;
        cancelPause = null;
        input.resume();
      });
      cancelPause = cancel;
    },
    /** The paused turn is gone: its pause wakes nothing. */
    stopPause,
    /** Starts counting the silence after a question, from now. */
    awaitReply() {
      stopAwaitingReply();
      const cancel = afterMs(input.waits, UNANSWERED_AFTER_MS, () => {
        if (cancelReply !== cancel) return;
        cancelReply = null;
        input.unanswered();
      });
      cancelReply = cancel;
    },
    stopAwaitingReply,
    /** The claim is ending: nothing wakes it again. */
    stop() {
      stopPause();
      stopAwaitingReply();
    },
  };
}
