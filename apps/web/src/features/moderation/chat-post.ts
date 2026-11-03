export type ChatPostFacts = {
  readonly banned: boolean;
  readonly slowModeSeconds: number;
  readonly lastPostAtMs: number | null;
  readonly nowMs: number;
};

export type ChatPostDecision =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'banned' }
  | { readonly kind: 'slow-mode'; readonly retryAfterMs: number };

/**
 * Whether an account may post to spectator chat now (WATCH-7). A ban always
 * refuses; slow mode spaces one account's posts, and rate limits sit in front
 * of this at the route. Spectator chat (SPECT-1.4) calls it before appending.
 */
export const decideChatPost = (facts: ChatPostFacts): ChatPostDecision => {
  if (facts.banned) return { kind: 'banned' };
  if (facts.lastPostAtMs === null || facts.slowModeSeconds === 0)
    return { kind: 'allowed' };
  const retryAfterMs =
    facts.lastPostAtMs + facts.slowModeSeconds * 1000 - facts.nowMs;
  return retryAfterMs > 0
    ? { kind: 'slow-mode', retryAfterMs }
    : { kind: 'allowed' };
};
