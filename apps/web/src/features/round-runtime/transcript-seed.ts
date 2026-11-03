import type { LiveTranscriptRead } from '@daisy/protocol';
import type { ResourceRead } from '../resource-sync/driver';

/** What a page whose transcript seed was refused knows now. */
export type TranscriptSeed =
  | { readonly kind: 'asking' }
  | { readonly kind: 'found'; readonly seed: LiveTranscriptRead }
  | { readonly kind: 'denied' }
  | { readonly kind: 'outdated' };

/**
 * Asks again until a read settles, so a refused seed starts the live transcript
 * with no reload of the page and its media (ISSUE-963). Refusals read as
 * missing, so a denial ends here too; only a plain outage asks again.
 */
export function askForTranscriptSeed(input: {
  readonly read: () => Promise<ResourceRead<LiveTranscriptRead>>;
  /** Runs its argument later; the answer cancels that. */
  readonly schedule: (attempt: () => void) => () => void;
  readonly settled: (seed: Exclude<TranscriptSeed, { kind: 'asking' }>) => void;
}): () => void {
  let stopped = false;
  let cancel = () => {};
  const attempt = async () => {
    const answer = await input.read();
    if (stopped) return;
    if (answer.kind === 'found')
      input.settled({ kind: 'found', seed: answer.value });
    else if (answer.kind === 'missing') input.settled({ kind: 'denied' });
    else if (answer.outdated) input.settled({ kind: 'outdated' });
    else ask();
  };
  const ask = () => {
    cancel = input.schedule(() => void attempt());
  };
  ask();
  return () => {
    stopped = true;
    cancel();
  };
}
