import type { BotPublicationScope } from '@daisy/db/bot-publication';

/** Capture closes a clip a little after the words end; the line may end just short of the instant heard. */
const SLACK_MS = 500;
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
 * It never rejects: a read that fails is a wait that ended.
 */
export function createPeerLineWait(input: {
  readonly claim: {
    readonly scope: BotPublicationScope;
    readonly token: string;
    readonly peerParticipantIds: readonly string[];
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
  /** How a wait ended, for the hearing's trace. */
  readonly waited: (outcome: 'line' | 'cap' | 'unread', ms: number) => void;
}) {
  const { scope, token, peerParticipantIds } = input.claim;
  return async (spokeUntilMs: number, signal: AbortSignal): Promise<void> => {
    const since = new Date(spokeUntilMs - SLACK_MS).toISOString();
    const startedAt = input.monotonicNowMs();
    const elapsed = () => Math.round(input.monotonicNowMs() - startedAt);
    while (!signal.aborted) {
      try {
        if (await input.readPeerLine(scope, token, peerParticipantIds, since))
          return input.waited('line', elapsed());
      } catch {
        return input.waited('unread', elapsed());
      }
      if (elapsed() + READ_EVERY_MS > WAIT_AT_MOST_MS) break;
      await input.sleep(READ_EVERY_MS, signal);
    }
    if (!signal.aborted) input.waited('cap', elapsed());
  };
}
