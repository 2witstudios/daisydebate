import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import type { Side } from './turns';

/** One finished debate in the signed-in account's history. */
export type MyDebate = {
  readonly id: string;
  readonly title: string;
  /** UTC ISO timestamp. */
  readonly endedAt: string;
  readonly mode: 'ranked' | 'practice';
  readonly side: Side;
  readonly opponent: string;
  readonly result: 'won' | 'lost' | 'draw';
  /** Ranked results only. */
  readonly ratingChange: number | null;
  readonly judge:
    | { readonly kind: 'person'; readonly handle: string }
    | { readonly kind: 'ai' }
    | { readonly kind: 'assigned' };
  readonly recordingId: string | null;
};

export const tabs = ['all', 'won', 'lost', 'ranked', 'practice'] as const;
export type Tab = (typeof tabs)[number];

export const pageSize = 5;

export type DebatesQuery = { readonly tab: Tab; readonly page: number };

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export function parseDebatesQuery(params: SearchParams): DebatesQuery {
  return {
    tab: z.enum(tabs).catch('all').parse(first(params['tab'])),
    page: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().min(1))
      .catch(1)
      .parse(first(params['page'])),
  };
}

export const debatesHref = (query: DebatesQuery): string => {
  const params = new URLSearchParams();
  if (query.tab !== 'all') params.set('tab', query.tab);
  if (query.page !== 1) params.set('page', String(query.page));
  const search = params.toString();
  return search === '' ? '/debates' : `/debates?${search}`;
};

const inTab = (debate: MyDebate, tab: Tab): boolean =>
  tab === 'all' ||
  (tab === 'won' && debate.result === 'won') ||
  (tab === 'lost' && debate.result === 'lost') ||
  (tab === 'ranked' && debate.mode === 'ranked') ||
  (tab === 'practice' && debate.mode === 'practice');

export type DebatesListing = {
  readonly rows: readonly MyDebate[];
  readonly counts: Readonly<Record<Tab, number>>;
  readonly page: number;
  readonly pageCount: number;
};

/** The history for a query: filtered by tab, newest first, one page. */
export function listing(
  all: readonly MyDebate[],
  query: DebatesQuery,
): DebatesListing {
  const matching = [...all]
    .filter((debate) => inTab(debate, query.tab))
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(query.page, pageCount);
  return {
    rows: matching.slice((page - 1) * pageSize, page * pageSize),
    counts: Object.fromEntries(
      tabs.map((tab) => [
        tab,
        all.filter((debate) => inTab(debate, tab)).length,
      ]),
    ) as Record<Tab, number>,
    page,
    pageCount,
  };
}

/** `Today`, `Yesterday` or `N days ago`, from the injected `now`. */
export function endedLabel(endedAt: string, now: string): string {
  const days = Math.floor((Date.parse(now) - Date.parse(endedAt)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

/** Who judged, in words. */
export function judgeLine(judge: MyDebate['judge']): string {
  if (judge.kind === 'person') return `Judge @${judge.handle}`;
  return judge.kind === 'ai'
    ? 'Placeholder AI judge'
    : 'Judge assigned by Daisy';
}

/** Who won, from the recorded result and the side the viewer was on. */
const outcomeOf = (debate: MyDebate): 'affirmative' | 'negative' | 'draw' => {
  if (debate.result === 'draw') return 'draw';
  const other = debate.side === 'affirmative' ? 'negative' : 'affirmative';
  return debate.result === 'won' ? debate.side : other;
};

/**
 * The completed result page for a debate in the history, carrying the
 * recorded outcome so the page shows it instead of working one out.
 */
export const resultHref = (debate: MyDebate): string => {
  const by = debate.judge.kind === 'ai' ? 'ai' : 'person';
  return `/debates/${debate.id}?turn=6&kind=${by}&by=${by}&win=${outcomeOf(debate)}`;
};
