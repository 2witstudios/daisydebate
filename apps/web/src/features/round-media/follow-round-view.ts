import type { RoundView } from '@daisy/protocol';
import type { MediaReadEvent } from './media-read-intent';
import { nextMediaRefreshAt } from './refresh-deadline';

/**
 * What accepted Round projections ask of media, for one mount. Each view also
 * asks for one coalesced read, so a same-version refresh corrects a boundary
 * read that reached the server too early. A due deadline is always offered,
 * because `decideMediaRead` keeps only the first offer; sent beside a newer view
 * it costs one read, since neither event has started one yet. Each deadline
 * refreshes the view once; the view's own backstop poll paces any retry. The
 * clock owns what "now" and "at this deadline" mean, so it can be calibrated.
 */
export function createRoundViewFollower(input: {
  readonly clock: {
    readonly now: () => number;
    readonly at: (deadlineMs: number, fire: () => void) => () => void;
  };
  readonly reconcile: (event: MediaReadEvent) => void;
  readonly refresh: () => void;
}) {
  let refreshedDeadlineMs: number | null = null;
  return (view: RoundView): (() => void) => {
    const { clock, reconcile } = input;
    reconcile({ kind: 'view', roundViewVersion: view.version });
    reconcile({ kind: 'wake' });
    const deadlineMs = nextMediaRefreshAt(view, clock.now());
    if (deadlineMs === null) return () => undefined;
    const boundary = {
      kind: 'boundary',
      roundViewVersion: view.version,
      deadlineMs,
    } as const;
    if (deadlineMs <= clock.now()) reconcile(boundary);
    if (refreshedDeadlineMs === deadlineMs) return () => undefined;
    return clock.at(deadlineMs, () => {
      refreshedDeadlineMs = deadlineMs;
      input.refresh();
      reconcile(boundary);
    });
  };
}
