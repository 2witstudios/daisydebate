/**
 * The id and deadline of the *earliest* unanswered ping (ADR 0031 §7). Only
 * a pong with that id answers it, and nothing pushes its deadline later once
 * set, so repeated visibility nudges can never defer detecting a dead socket.
 */
export function createOutstandingPing(deadAfterMs: number) {
  let id: string | null = null;
  let deadline: number | null = null;
  return {
    /** Starts tracking `pingId` unless an earlier ping is still unanswered, or when `force`d. */
    track(pingId: string, nowMs: number, force = false) {
      if (id !== null && !force) return;
      id = pingId;
      deadline = nowMs + deadAfterMs;
    },
    answer(pingId: string) {
      if (pingId === id) this.clear();
    },
    clear() {
      id = null;
      deadline = null;
    },
    pending: () => deadline !== null,
    overdue: (nowMs: number) => deadline !== null && nowMs >= deadline,
  };
}
