/**
 * How a Tab screen stays readable at scale (120 rooms, 200 entries, a
 * bracket of 64): Needs you capped and kept first, similar items merged into
 * one row, long groups cut to a counted remainder, search and a status filter
 * within the page, and a bracket from its live round onward. The functions
 * here and in `at-scale-rooms` shape the screen's existing read.
 *
 * In-page state rides in the URL, so it works before hydration and a page
 * gets its data the same way: `q` (search), `status` (the status filter) and
 * `open` (a group shown whole, repeatable).
 */

/** A page's search params, as Next hands them to a page. */
export type PageParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

/** What the page was asked to show: a search, a status, and the groups shown whole. */
export type PageFilter<Status extends string> = {
  readonly query: string;
  readonly status: Status | 'all';
  readonly open: ReadonlySet<string>;
};

const QUERY_LIMIT = 80;

const valuesOf = (value: string | readonly string[] | undefined) =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

/**
 * The page's filter from its URL. The URL is untrusted: an unknown status
 * reads as all, and the search is trimmed and cut to 80 characters.
 */
export function pageFilterOf<Status extends string>(
  params: PageParams,
  statuses: readonly Status[],
): PageFilter<Status> {
  const query = (valuesOf(params.q).at(-1) ?? '').trim().slice(0, QUERY_LIMIT);
  const asked = valuesOf(params.status).at(-1) ?? 'all';
  const status = statuses.find((known) => known === asked) ?? 'all';
  return { query, status, open: new Set(valuesOf(params.open)) };
}

/**
 * The address of the page with this filter, keeping only what is set. A
 * path may carry the page's own params (a draw's `?fixture=`): they stay.
 */
export function pageHref<Status extends string>(
  path: string,
  filter: PageFilter<Status>,
): string {
  const [base = '', own = ''] = path.split('?');
  const params = new URLSearchParams(own);
  for (const key of ['q', 'status', 'open']) params.delete(key);
  if (filter.query !== '') params.set('q', filter.query);
  if (filter.status !== 'all') params.set('status', filter.status);
  for (const group of [...filter.open].sort()) params.append('open', group);
  const search = params.toString();
  return search === '' ? base : `${base}?${search}`;
}

/** The same page with one more group shown whole. */
export const showAllHref = <Status extends string>(
  path: string,
  filter: PageFilter<Status>,
  group: string,
): string =>
  pageHref(path, { ...filter, open: new Set([...filter.open, group]) });

const folded = (text: string) =>
  text.normalize('NFKD').replaceAll(/\p{M}/gu, '').toLowerCase();

/**
 * Whether a row's words answer a search: every word of the search is found
 * in one of them, ignoring case and accents. An empty search finds anything.
 */
export function matchesQuery(query: string, texts: readonly string[]): boolean {
  const words = folded(query).split(/\s+/).filter(Boolean);
  const haystack = texts.map(folded);
  return words.every((word) => haystack.some((text) => text.includes(word)));
}

/** How a list is searched and sorted into statuses. */
export type RowFacets<Row, Status extends string> = {
  /** The words a search may find a row by: its names, school, room and judges. */
  readonly textOf: (row: Row) => readonly string[];
  readonly statusOf: (row: Row) => Status;
};

/** The rows the filter keeps, in their order. */
export function filterRows<Row, Status extends string>(
  rows: readonly Row[],
  filter: PageFilter<Status>,
  facets: RowFacets<Row, Status>,
): readonly Row[] {
  return rows.filter(
    (row) =>
      (filter.status === 'all' || facets.statusOf(row) === filter.status) &&
      matchesQuery(filter.query, facets.textOf(row)),
  );
}

/** One choice of the status filter, such as "Live 54". */
export type StatusChoice = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly href: string;
  readonly selected: boolean;
};

/**
 * The status filter's choices, All first, each counting the rows the search
 * finds in it and keeping the search in its address.
 */
export function statusChoices<Row, Status extends string>(
  rows: readonly Row[],
  filter: PageFilter<Status>,
  facets: RowFacets<Row, Status>,
  options: {
    readonly path: string;
    readonly labels: Readonly<Record<Status, string>>;
    readonly statuses: readonly Status[];
  },
): readonly StatusChoice[] {
  const found = rows.filter((row) =>
    matchesQuery(filter.query, facets.textOf(row)),
  );
  const choice = (status: Status | 'all', label: string): StatusChoice => ({
    id: status,
    label,
    count:
      status === 'all'
        ? found.length
        : found.filter((row) => facets.statusOf(row) === status).length,
    href: pageHref(options.path, { ...filter, status, open: new Set() }),
    selected: filter.status === status,
  });
  return [
    choice('all', 'All'),
    ...options.statuses.map((status) => choice(status, options.labels[status])),
  ];
}

/** Needs you, capped: the first few shown, the rest counted. */
export type Capped<Item> = {
  readonly shown: readonly Item[];
  readonly hidden: number;
};

/** Keep the first `limit` items, in their order, and count the rest. */
export function capped<Item>(
  items: readonly Item[],
  limit: number,
): Capped<Item> {
  const kept = Math.max(0, limit);
  return {
    shown: items.slice(0, kept),
    hidden: Math.max(0, items.length - kept),
  };
}

/** One row of a merged list: a single item, or several alike as one. */
export type Merged<Item> = {
  /** What made them alike; null for an item that merges with nothing. */
  readonly key: string | null;
  readonly items: readonly Item[];
};

/**
 * Items alike merged into one row where they sit first ("6 ballots are
 * overdue"). An item whose key is null stands alone; so does a key only one
 * item has, which keeps its key.
 */
export function mergeSimilar<Item>(
  items: readonly Item[],
  keyOf: (item: Item) => string | null,
): readonly Merged<Item>[] {
  const rows: { key: string | null; items: Item[] }[] = [];
  const byKey = new Map<string, Item[]>();
  for (const item of items) {
    const key = keyOf(item);
    const same = key === null ? undefined : byKey.get(key);
    if (same !== undefined) {
      same.push(item);
      continue;
    }
    const row = { key, items: [item] };
    if (key !== null) byKey.set(key, row.items);
    rows.push(row);
  }
  return rows;
}

/** "Jensen v Amari", "Jensen v Amari and Haddad v Castillo", or "Jensen v Amari and 6 more". */
export function andMore(titles: readonly string[]): string {
  const [first = '', second] = titles;
  if (titles.length <= 1) return first;
  if (titles.length === 2) return `${first} and ${second ?? ''}`;
  return `${first} and ${titles.length - 1} more`;
}

/** A long group cut to its first rows, with the rest counted. */
export type Collapsed<Item> = {
  readonly shown: readonly Item[];
  /** How many rows are not shown: the "31 more" of "31 more judging". */
  readonly rest: number;
  /** Every row of the group: the "34" of "Show all 34". */
  readonly total: number;
};

/**
 * A group shown whole when it is open or short enough; otherwise its first
 * `limit` rows and a count of the rest. A remainder of one is shown rather
 * than counted, since a row saying "1 more" takes the room the row would.
 */
export function collapsed<Item>(
  items: readonly Item[],
  options: { readonly limit: number; readonly open: boolean },
): Collapsed<Item> {
  const limit = Math.max(0, options.limit);
  const whole = options.open || items.length <= limit + 1;
  const shown = whole ? items : items.slice(0, limit);
  return {
    shown,
    rest: items.length - shown.length,
    total: items.length,
  };
}
