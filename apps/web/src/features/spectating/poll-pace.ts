/** The ordinary pace of a viewer's reads. */
export const POLL_MS = 2000;
/** The longest a viewer stays away when reads keep missing. */
export const POLL_MAX_MS = 30_000;
const SPREAD = 0.2;

export type PollAnswer =
  | { readonly kind: 'answered' }
  /** The server said it is full; a null wait leaves the pace to the backoff. */
  | { readonly kind: 'refused'; readonly retryAfterMs: number | null }
  | { readonly kind: 'failed' };

/** What one response says about the next read. */
export const answerOfResponse = (response: Response): PollAnswer => {
  if (response.ok || response.status === 404) return { kind: 'answered' };
  if (response.status !== 503 && response.status !== 429)
    return { kind: 'failed' };
  const seconds = Number(response.headers.get('retry-after'));
  return {
    kind: 'refused',
    retryAfterMs: seconds > 0 ? seconds * 1000 : null,
  };
};

/**
 * When to read next, and how many misses in a row that makes. `unit` is in [0, 1),
 * so a crowd that arrived together does not stay in step. A miss doubles the wait
 * up to the limit, and a refusal is never asked again sooner than it said.
 */
export const nextPollDelayMs = (
  misses: number,
  answer: PollAnswer,
  spread: () => number,
): { readonly misses: number; readonly delayMs: number } => {
  const nextMisses = answer.kind === 'answered' ? 0 : misses + 1;
  const base = Math.min(POLL_MAX_MS, POLL_MS * 2 ** nextMisses);
  const spreadBase = Math.round(base * (1 + SPREAD * (2 * spread() - 1)));
  const atLeast = answer.kind === 'refused' ? (answer.retryAfterMs ?? 0) : 0;
  return { misses: nextMisses, delayMs: Math.max(spreadBase, atLeast) };
};

/**
 * Reads on that pace until stopped. What the reader shows stays until a read
 * replaces it: the loop only decides when to ask again. Returns the stop.
 */
export const startPacedPoll = (deps: {
  readonly read: () => Promise<PollAnswer>;
  readonly spread: () => number;
  readonly schedule: (ms: number, run: () => void) => () => void;
}): (() => void) => {
  let stopped = false;
  let cancel = () => undefined as void;
  const after = (misses: number, answer: PollAnswer) => {
    if (stopped) return;
    const next = nextPollDelayMs(misses, answer, deps.spread);
    cancel = deps.schedule(next.delayMs, () => {
      void deps.read().then(
        (read) => after(next.misses, read),
        () => after(next.misses, { kind: 'failed' }),
      );
    });
  };
  after(0, { kind: 'answered' });
  return () => {
    stopped = true;
    cancel();
  };
};
