import type { RoundView } from '@daisy/protocol';
import type { MediaReadEvent } from './media-read-intent';
import { nextMediaRefreshAt } from './refresh-deadline';

/**
 * What one accepted Round projection asks of media. Returns the cancel of its
 * deadline. A refresh at the same version still asks for one coalesced read,
 * because an early boundary read is corrected by the read after it. A deadline
 * already due is covered by the read this view starts, so it refreshes only.
 */
export function followRoundView(input: {
  readonly view: RoundView;
  readonly nowMs: number;
  readonly reconcile: (event: MediaReadEvent) => void;
  readonly refresh: () => void;
  readonly schedule: (fire: () => void, delayMs: number) => () => void;
}): () => void {
  const { view, reconcile } = input;
  reconcile({ kind: 'view', roundViewVersion: view.version });
  reconcile({ kind: 'wake' });
  const deadlineMs = nextMediaRefreshAt(view);
  if (deadlineMs === null) return () => undefined;
  const delayMs = deadlineMs - input.nowMs;
  return input.schedule(
    () => {
      input.refresh();
      if (delayMs > 0)
        reconcile({
          kind: 'boundary',
          roundViewVersion: view.version,
          deadlineMs,
        });
    },
    Math.max(0, delayMs),
  );
}
