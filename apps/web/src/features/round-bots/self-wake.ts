import type { OneShotTimer } from '../../lib/worker-timers';

/** After a refusal that can clear, the speaker wakes itself this soon... */
const RETRY_FIRST_MS = 200;
/** ...doubling while the refusal repeats, up to the control pulse's own pace. */
const RETRY_MAX_MS = 3000;
/** An asking seat presses its question after this much silence from its peers. */
const UNANSWERED_AFTER_MS = 8000;

/**
 * The two times a speaker wakes by itself rather than on a pulse: shortly
 * after a refusal that can clear, and once the asking seat's question has
 * met silence for long enough. While a pause runs, `pausing` is true and
 * the speaker starts nothing.
 */
export function createSelfWake(input: {
  readonly timer: OneShotTimer;
  /** The pause after a refusal is over. */
  readonly resume: () => void;
  /** The question has met silence for long enough. */
  readonly unanswered: () => void;
}) {
  let pause: { readonly handle: unknown } | null = null;
  let pauseMs = RETRY_FIRST_MS;
  let reply: { readonly handle: unknown } | null = null;
  const stopAwaitingReply = () => {
    if (reply) input.timer.clearTimeout(reply.handle);
    reply = null;
  };
  return {
    pausing: () => pause !== null,
    /** Pauses, then resumes; each pause in a row is twice the last, to a ceiling. */
    retrySoon() {
      if (pause) return;
      const wait = pauseMs;
      pauseMs = Math.min(pauseMs * 2, RETRY_MAX_MS);
      const mine = {
        handle: undefined as unknown,
      };
      pause = mine;
      mine.handle = input.timer.setTimeout(() => {
        if (pause !== mine) return;
        pause = null;
        input.resume();
      }, wait);
    },
    /** Something was said: a later refusal starts its pauses short again. */
    progressed() {
      pauseMs = RETRY_FIRST_MS;
    },
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
      if (pause) input.timer.clearTimeout(pause.handle);
      pause = null;
      stopAwaitingReply();
    },
  };
}
