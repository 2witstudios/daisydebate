import type { OneShotTimer } from '../../lib/worker-timers';

/** An asking seat presses its question after this much silence from its peers. */
const UNANSWERED_AFTER_MS = 8000;

/**
 * The two times a speaker wakes by itself rather than on a pulse: when the
 * pause after a setback is over, and once the asking seat's question has met
 * silence for long enough. It only keeps time: whether a turn is paused, and
 * for how long, is the duty's to say.
 */
export function createSelfWake(input: {
  readonly timer: OneShotTimer;
  /** The pause after a setback is over. */
  readonly resume: () => void;
  /** The question has met silence for long enough. */
  readonly unanswered: () => void;
}) {
  let pause: { readonly handle: unknown } | null = null;
  let reply: { readonly handle: unknown } | null = null;
  const stopPause = () => {
    if (pause) input.timer.clearTimeout(pause.handle);
    pause = null;
  };
  const stopAwaitingReply = () => {
    if (reply) input.timer.clearTimeout(reply.handle);
    reply = null;
  };
  return {
    /** Resumes after `ms`; a pause already running is replaced. */
    pauseFor(ms: number) {
      stopPause();
      const mine = { handle: undefined as unknown };
      pause = mine;
      mine.handle = input.timer.setTimeout(() => {
        if (pause !== mine) return;
        pause = null;
        input.resume();
      }, ms);
    },
    /** The paused turn is gone: its pause wakes nothing. */
    stopPause,
    /** Starts counting the silence after a question, from now. */
    awaitReply() {
      stopAwaitingReply();
      const mine = { handle: undefined as unknown };
      reply = mine;
      mine.handle = input.timer.setTimeout(() => {
        if (reply !== mine) return;
        reply = null;
        input.unanswered();
      }, UNANSWERED_AFTER_MS);
    },
    stopAwaitingReply,
    /** The claim is ending: nothing wakes it again. */
    stop() {
      stopPause();
      stopAwaitingReply();
    },
  };
}
