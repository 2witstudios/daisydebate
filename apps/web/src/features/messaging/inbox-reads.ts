import { appendPage, type MessagingInboxPageAnswer } from './inbox-view';

type Scheduler = {
  readonly after: (work: () => void, ms: number) => () => void;
};

/** The longest a burst of rings waits, and the search's typing pause. */
const inboxRingCoalesceMs = 750;
const inboxSearchDebounceMs = 250;

/**
 * The list's one reader. A ring re-reads every page the reader has loaded and
 * replaces the list with that answer, because only a fresh read can say a
 * conversation left: a hidden, revoked or erased one must not stay on screen for
 * being past the first page. Rings coalesce into at most one refresh in flight
 * and one after it, a search waits for typing to pause, and only the newest
 * question's answer applies. A failed read keeps everything shown. Injected fetch
 * and timers keep it pure of the browser.
 */
export function createInboxReads({
  readPage,
  scheduler,
  initialPages = 1,
  onRefreshed,
  onNextPage,
}: {
  readonly readPage: (query: {
    readonly q: string | null;
    readonly after: string | null;
  }) => Promise<MessagingInboxPageAnswer | null>;
  readonly scheduler: Scheduler;
  readonly initialPages?: number;
  readonly onRefreshed: (
    page: MessagingInboxPageAnswer,
    fresh: { readonly q: string | null },
  ) => void;
  readonly onNextPage: (page: MessagingInboxPageAnswer) => void;
}) {
  let q: string | null = null;
  /** Changes with the question asked, or with what a refresh must cover. */
  let generation = 0;
  let pages = initialPages;
  let inFlight = false;
  let again = false;
  let cancelPending: (() => void) | null = null;
  let closed = false;

  /** Every loaded page in order, or null if any one could not be read. */
  const readLoaded = async (
    askedQ: string | null,
    count: number,
  ): Promise<MessagingInboxPageAnswer | null> => {
    let answer: MessagingInboxPageAnswer = { entries: [], nextAfter: null };
    let after: string | null = null;
    for (let index = 0; index < count; index += 1) {
      const page: MessagingInboxPageAnswer | null = await readPage({
        q: askedQ,
        after,
      }).catch(() => null);
      if (page === null) return null;
      answer = appendPage(answer, page);
      after = page.nextAfter;
      if (after === null) break;
    }
    return answer;
  };
  const refresh = async () => {
    cancelPending = null;
    if (closed) return;
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    const asked = generation;
    const askedQ = q;
    const answer = await readLoaded(askedQ, pages);
    inFlight = false;
    if (closed) return;
    if (answer !== null && asked === generation)
      onRefreshed(answer, { q: askedQ });
    if (again || asked !== generation) {
      again = false;
      schedule(asked !== generation ? 0 : inboxRingCoalesceMs * pages);
    }
  };
  const schedule = (ms: number) => {
    if (cancelPending !== null) return;
    cancelPending = scheduler.after(() => void refresh(), ms);
  };
  return {
    /** A doorbell: something changed; ask once the burst has passed. */
    ring() {
      schedule(inboxRingCoalesceMs * pages);
    },
    /** A new search; an empty one returns to the whole inbox. */
    search(next: string | null) {
      if (next === q) return;
      q = next;
      pages = 1;
      generation += 1;
      cancelPending?.();
      cancelPending = null;
      schedule(inboxSearchDebounceMs);
    },
    /** The next page, for the question now asked. */
    async more(after: string) {
      const asked = generation;
      const page = await readPage({ q, after }).catch(() => null);
      if (!closed && page !== null && asked === generation) {
        pages += 1;
        // A refresh already under way no longer covers what is loaded.
        generation += 1;
        onNextPage(page);
      }
      return page !== null;
    },
    close() {
      closed = true;
      cancelPending?.();
      cancelPending = null;
    },
  };
}
