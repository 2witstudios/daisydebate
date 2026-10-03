import type { SearchParams } from '../access/decision';

const hitKinds = ['person', 'debate', 'tournament', 'room'] as const;
export type HitKind = (typeof hitKinds)[number];

/** One thing a search can find: what it is called and where it lives. */
export type SearchItem = {
  readonly kind: HitKind;
  readonly label: string;
  readonly detail: string;
  readonly href: string;
};

const maxQueryLength = 80;

/** The query from the address: trimmed, bounded, empty when absent. */
export function parseSearchQuery(params: SearchParams): string {
  const raw = params['q'];
  const value = typeof raw === 'string' ? raw : (raw?.[0] ?? '');
  return value.trim().slice(0, maxQueryLength);
}

/** Items whose label or detail contains every word of the query. */
export function searchItems(
  query: string,
  items: readonly SearchItem[],
): readonly SearchItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return items.filter((item) => {
    const text = `${item.label} ${item.detail}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export type SearchGroup = {
  readonly kind: HitKind;
  readonly items: readonly SearchItem[];
};

/** Hits grouped by kind, in a fixed order, skipping kinds with no hit. */
export const groupHits = (
  hits: readonly SearchItem[],
): readonly SearchGroup[] =>
  hitKinds
    .map((kind) => ({
      kind,
      items: hits.filter((hit) => hit.kind === kind),
    }))
    .filter((group) => group.items.length > 0);
