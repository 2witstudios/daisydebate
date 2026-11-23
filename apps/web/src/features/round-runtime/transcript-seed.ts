import type { LiveTranscriptRead } from '@daisy/protocol/round-transcript';
import type { ResourceRead } from '../resource-sync/driver';

/** What a page whose transcript seed was refused knows now. */
export type TranscriptSeed =
  | { readonly kind: 'asking' }
  | { readonly kind: 'found'; readonly seed: LiveTranscriptRead }
  | { readonly kind: 'denied' }
  | { readonly kind: 'outdated' };

/**
 * Asks again until a seed or a denial arrives, so a refused seed starts the live
 * transcript with no reload of the page and its media (ISSUE-963). Refusals read
 * as missing, so a denial ends here too. An outdated answer is reported but not
 * final: the next read may reach an instance this build can parse.
 */
export function askForTranscriptSeed(input: {
  readonly read: () => Promise<ResourceRead<LiveTranscriptRead>>;
  /** Runs its argument after `ms`; the answer cancels that. */
  readonly after: (attempt: () => void, ms: number) => () => void;
  /** How long to wait before the numbered ask. */
  readonly waitMs: (asked: number) => number;
  readonly settled: (seed: Exclude<TranscriptSeed, { kind: 'asking' }>) => void;
}): () => void {
  let stopped = false;
  let asked = 0;
  let cancel = () => {};
  const attempt = async () => {
    // A thrown read counts as unavailable, as in the resource sync driver.
    const answer = await input
      .read()
      .catch((): ResourceRead<LiveTranscriptRead> => ({ kind: 'unavailable' }));
    if (stopped) return;
    if (answer.kind === 'found')
      input.settled({ kind: 'found', seed: answer.value });
    else if (answer.kind === 'missing') input.settled({ kind: 'denied' });
    else {
      if (answer.outdated) input.settled({ kind: 'outdated' });
      ask();
    }
  };
  const ask = () => {
    cancel = input.after(() => void attempt(), input.waitMs(asked++));
  };
  ask();
  return () => {
    stopped = true;
    cancel();
  };
}
