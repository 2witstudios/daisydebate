/**
 * The Prep library's domain shapes. They are persistence-neutral view shapes
 * a real read replaces the mock with; sides are Aff and Neg only.
 */
export type Side = 'aff' | 'neg';

/** Private to the owner, or shared with a named team. */
export type Visibility =
  | { readonly kind: 'private' }
  | { readonly kind: 'team'; readonly teamName: string };

type ItemBase = {
  readonly id: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly visibility: Visibility;
  /** ISO timestamp. */
  readonly editedAt: string;
  readonly usedIn: number;
};

type BriefItem = ItemBase & {
  readonly kind: 'brief';
  readonly motion: string;
  readonly side: Side;
  readonly contentions: number;
};

type CardItem = ItemBase & {
  readonly kind: 'card';
  readonly author: string;
  readonly publication: string;
  readonly year: string;
  /** The outlet, journal or publisher the source came from. */
  readonly outlet: string;
  /** The passage read aloud; the full-text search reads it. */
  readonly passage: string;
};

type CaseItem = ItemBase & {
  readonly kind: 'case';
  readonly motion: string;
  readonly side: Side;
  readonly version: number;
};

export type LibraryItem = BriefItem | CardItem | CaseItem;
export type ItemKind = LibraryItem['kind'];

export const sideLabel = (side: Side): string =>
  side === 'aff' ? 'Aff' : 'Neg';

/** The second line of a row, by kind. */
export function itemSubtitle(item: LibraryItem): string {
  switch (item.kind) {
    case 'brief':
      return `${item.motion} · ${sideLabel(item.side)} · ${item.contentions} ${
        item.contentions === 1 ? 'contention' : 'contentions'
      }`;
    case 'card':
      return `${item.author}, ${item.publication}, ${item.year} · Source: ${item.outlet}`;
    case 'case':
      return `${item.motion} · ${sideLabel(item.side)} · v${item.version}`;
  }
}

/** Where an item opens. */
export function itemHref(item: LibraryItem): string {
  switch (item.kind) {
    case 'brief':
      return `/prep/briefs/${item.id}`;
    case 'card':
      return `/prep/cards/${item.id}`;
    case 'case':
      return `/prep/cases/${item.id}`;
  }
}
