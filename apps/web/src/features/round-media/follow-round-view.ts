import type { RoundView } from '@daisy/protocol';
import type { MediaReadEvent } from './media-read-intent';
import { nextMediaRefreshAt } from './refresh-deadline';

/**
 * What accepted Round projections ask of media, for one mount. Each view also
 * asks for one coalesced read, so a same-version refresh corrects a boundary
 * read that reached the server too early. A due deadline is always offered,
 * because `decideMediaRead` keeps only the first offer; sent beside a newer view
 * it costs one read, since neither event has started one yet. Each deadline
 * refreshes the view once; the view's own backstop poll paces any retry.
 */
export function createRoundViewFollower(input: {
  readonly now: () => number;
  readonly reconcile: (event: MediaReadEvent) => void;
  readonly refresh: () => void;
  readonly schedule: (fire: () => void, delayMs: number) => () => void;
}) {
  let refreshedDeadlineMs: number | null = null;
  return (view: RoundView): (() => void) => {
    const { reconcile, refresh, schedule } = input;
    reconcile({ kind: 'view', roundViewVersion: view.version });
    reconcile({ kind: 'wake' });
    const deadlineMs = nextMediaRefreshAt(view);
    if (deadlineMs === null) return () => undefined;
    const boundary = {
      kind: 'boundary',
      roundViewVersion: view.version,
      deadlineMs,
    } as const;
    const delayMs = deadlineMs - input.now();
    if (delayMs > 0)
      return schedule(() => {
        refreshedDeadlineMs = deadlineMs;
        refresh();
        reconcile(boundary);
      }, delayMs);
    reconcile(boundary);
    if (refreshedDeadlineMs === deadlineMs) return () => undefined;
    refreshedDeadlineMs = deadlineMs;
    return schedule(refresh, 0);
  };
}
