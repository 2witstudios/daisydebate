import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import {
  subscriptionFreshness,
  type SubscriptionFreshnessFacts,
  type SubscriptionFreshness,
} from './subscription-staleness';

type Store = ReturnType<Database['billingSubscriptionStaleness']>;
type Page = Awaited<ReturnType<Store['sample']>>;
type Scan = {
  readonly cursor: { readonly afterId: string; readonly throughId: string };
  readonly facts: SubscriptionFreshnessFacts;
  readonly startedAt: string;
  readonly pages: number;
};
type State =
  | { readonly kind: 'idle' | 'stopped' }
  | { readonly kind: 'scanning'; readonly scan: Scan };
const older = (a: string | null, b: string | null) =>
  a === null ? b : b === null ? a : a < b ? a : b;
function accumulate(page: Page, scan?: Scan): SubscriptionFreshnessFacts {
  if (!scan) return page;
  const facts = scan.facts;
  if (
    page.throughId !== scan.cursor.throughId ||
    page.sampledAt < facts.sampledAt ||
    (!page.exhausted &&
      (page.afterId === null || page.afterId <= scan.cursor.afterId))
  )
    throw createAppError(
      'INFRASTRUCTURE',
      'Subscription freshness traversal is inconsistent',
    );
  return {
    sampledAt: page.sampledAt,
    scanned: facts.scanned + page.scanned,
    pending: facts.pending + page.pending,
    claimed: facts.claimed + page.claimed,
    settled: facts.settled + page.settled,
    unconfirmed: facts.unconfirmed + page.unconfirmed,
    oldestRevisionRequestedAt: older(
      facts.oldestRevisionRequestedAt,
      page.oldestRevisionRequestedAt,
    ),
    oldestObservedAt: older(facts.oldestObservedAt, page.oldestObservedAt),
  };
}

function continuation(page: Page) {
  if (page.exhausted) return null;
  if (
    page.afterId === null ||
    page.throughId === null ||
    page.afterId > page.throughId
  )
    throw createAppError(
      'INFRASTRUCTURE',
      'Subscription freshness cursor is unavailable',
    );
  return { afterId: page.afterId!, throughId: page.throughId! };
}
function observePage(page: Page, scan?: Scan) {
  const facts = accumulate(page, scan),
    startedAt = scan?.startedAt ?? page.sampledAt,
    pages = (scan?.pages ?? 0) + 1;
  const cursor = continuation(page);
  const value = subscriptionFreshness(facts, page.exhausted, {
    startedAt,
    pages,
  });
  const state: State =
    cursor === null || value.status === 'unavailable'
      ? { kind: 'idle' }
      : {
          kind: 'scanning',
          scan: {
            facts,
            startedAt,
            pages,
            cursor,
          },
        };
  return { value, state };
}

/** One bounded page per tick; a finite cycle is an observed traversal, never an atomic fleet snapshot. */
export function createSubscriptionStalenessCollection(input: {
  readonly store: Store;
  readonly mode: 'test' | 'live';
  readonly observed: (value: SubscriptionFreshness) => void;
  readonly unavailable: (error: unknown) => void;
}) {
  let state: State = { kind: 'idle' };
  const stopped = () => state.kind === 'stopped';
  return {
    async run() {
      if (state.kind === 'stopped') return;
      const scan = state.kind === 'scanning' ? state.scan : undefined;
      try {
        const page = await input.store.sample({
          mode: input.mode,
          ...scan?.cursor,
        });
        if (stopped()) return;
        const next = observePage(page, scan);
        input.observed(next.value);
        if (!stopped()) state = next.state;
      } catch (error) {
        if (!stopped()) {
          state = { kind: 'idle' };
          input.unavailable(error);
        }
      }
    },
    stop() {
      state = { kind: 'stopped' };
    },
  };
}
