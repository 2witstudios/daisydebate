import type { MessagingInboxPageAnswer } from './inbox-view';

type Scheduler = {
  readonly after: (work: () => void, ms: number) => () => void;
};

/** The longest a burst of rings waits, and the search's typing pause. */
export const inboxRingCoalesceMs = 750;
export const inboxSearchDebounceMs = 250;

/**
 * The list's one reader: rings coalesce into at most one read in flight and one
 * after it, a search waits for typing to pause, and only the newest question's
 * answer applies, so an older answer can never overwrite a newer search.
 * Failures keep what is shown. Injected fetch and timers keep it pure of the browser.
 */
export function createInboxReads({
  readPage,
  scheduler,
  onFirstPage,
  onNextPage,
}: {
  readonly readPage: (query: {
    readonly q: string | null;
    readonly after: string | null;
  }) => Promise<MessagingInboxPageAnswer | null>;
  readonly scheduler: Scheduler;
  readonly onFirstPage: (
    page: MessagingInboxPageAnswer,
    fresh: { readonly q: string | null; readonly searchChanged: boolean },
  ) => void;
  readonly onNextPage: (page: MessagingInboxPageAnswer) => void;
}) {
  let q: string | null = null;
  let generation = 0;
  let inFlight = false;
  let again = false;
  let searchChanged = false;
  let cancelPending: (() => void) | null = null;
  let closed = false;

  const runFirstPage = async () => {
    cancelPending = null;
    if (closed) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const asked = generation;
    const askedQ = q;
    const page = await readPage({ q: askedQ, after: null }).catch(() => null);
    inFlight = false;
    if (closed) return;
    if (page !== null && asked === generation) {
      onFirstPage(page, { q: askedQ, searchChanged });
      searchChanged = false;
    }
    if (again || asked !== generation) {
      again = false;
      schedule(0);
    }
  };
  const schedule = (ms: number) => {
    if (cancelPending !== null) return;
    cancelPending = scheduler.after(() => void runFirstPage(), ms);
  };
  return {
    /** A doorbell: something changed; ask once the burst has passed. */
    ring() {
      schedule(inboxRingCoalesceMs);
    },
    /** A new search; an empty one returns to the whole inbox. */
    search(next: string | null) {
      if (next === q) return;
      q = next;
      generation += 1;
      searchChanged = true;
      cancelPending?.();
      cancelPending = null;
      schedule(inboxSearchDebounceMs);
    },
    /** The next page, for the question now asked. */
    async more(after: string) {
      const asked = generation;
      const page = await readPage({ q, after }).catch(() => null);
      if (!closed && page !== null && asked === generation) onNextPage(page);
      return page !== null;
    },
    close() {
      closed = true;
      cancelPending?.();
      cancelPending = null;
    },
  };
}
