import type { BotPublicationScope } from '@daisy/db/bot-publication';

/**
 * How far before the instant a peer last spoke their line may end. It covers
 * the hearing naming that instant early (at most its 400 ms echo tail), and
 * stays under capture's 500 ms clip pause, so the line found is the one that
 * holds the peer's last words, never the clip before it.
 */
const SLACK_MS = 450;
/** How often the transcript is read while waiting. */
const READ_EVERY_MS = 150;
/** Past this the answer is made from what the transcript holds. */
const WAIT_AT_MOST_MS = 4000;

/**
 * Waits for a peer's own words to reach the transcript before a
 * cross-examination answer is made from it. Capture writes a line a few
 * seconds after its speaker stops, so an answer made at once would answer
 * the line before. Capture stays the one source of those words: this only
 * reads, at most for `WAIT_AT_MOST_MS`, and then lets the answer go ahead.
 * It never rejects: a read that fails is asked again until the wait is over.
 */
export function createPeerLineWait(input: {
  readonly claim: {
    readonly scope: BotPublicationScope;
    readonly token: string;
  };
  readonly readPeerLine: (
    scope: BotPublicationScope,
    token: string,
    peers: readonly string[],
    since: string,
  ) => Promise<boolean>;
  /** Resolves after `ms`, or at once when `signal` aborts. */
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly monotonicNowMs: () => number;
  /**
   * The hearing's trace: how each wait ended (`line` or `cap`), how long it
   * took, and the Round it was in.
   */
  readonly observed: (
    operation: string,
    fields: { readonly durationMs: number; readonly roundId: string },
  ) => void;
}) {
  const { scope, token } = input.claim;
  return async (
    peer: string,
    spokeUntilMs: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const since = new Date(spokeUntilMs - SLACK_MS).toISOString();
    const startedAt = input.monotonicNowMs();
    const elapsed = () => Math.round(input.monotonicNowMs() - startedAt);
    const waited = (outcome: 'line' | 'cap') => {
      try {
        input.observed(`line.${outcome}`, {
          durationMs: elapsed(),
          roundId: scope.roundId,
        });
      } catch {
        /* A trace is best effort: its fault never fails the turn. */
      }
    };
    // One deadline for the whole wait: a slow read never stretches it.
    const capped = input
      .sleep(WAIT_AT_MOST_MS, signal)
      .then(() => 'cap' as const);
    // Only the peer whose turn ended: another peer's line is not their words.
    const read = () =>
      Promise.race([input.readPeerLine(scope, token, [peer], since), capped]);
    while (!signal.aborted) {
      // A read that fails (a full pool) is asked again at the next interval.
      const landed = await read().catch(() => false as const);
      if (landed === true) return waited('line');
      if (landed === 'cap' || elapsed() + READ_EVERY_MS > WAIT_AT_MOST_MS)
        break;
      await input.sleep(READ_EVERY_MS, signal);
    }
    if (!signal.aborted) waited('cap');
  };
}
