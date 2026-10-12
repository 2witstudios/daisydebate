import type { ItemKind } from '../../../features/prep/library/library-item';

const base =
  'inline-flex size-avatar-md shrink-0 items-center justify-center rounded-md';

const kinds: Readonly<Record<ItemKind, string>> = {
  brief: 'bg-accent-soft text-accent',
  card: 'bg-gold-soft text-gold',
  case: 'bg-surface-overlay text-ink-muted',
};

/** The icon tile in front of a library item: accent, gold or neutral by kind. */
export const itemTileClass = (kind: ItemKind): string =>
  `${base} ${kinds[kind]}`;

const hues: Readonly<Record<ItemKind, string>> = {
  brief: 'text-hue-sky',
  card: 'text-hue-clay',
  case: 'text-hue-plum',
};

const softHues: Readonly<Record<ItemKind, string>> = {
  brief: 'bg-hue-sky-soft text-hue-sky',
  card: 'bg-hue-clay-soft text-hue-clay',
  case: 'bg-hue-plum-soft text-hue-plum',
};

/** The kind word on a library row: sky briefs, clay cards, plum cases. */
export const itemKindClass = (kind: ItemKind): string =>
  `text-xs font-strong tracking-wide uppercase ${hues[kind]}`;

/** The kind badge on the preview pane, on its soft hue. */
export const itemBadgeClass = (kind: ItemKind): string =>
  `rounded-badge px-2 py-1 text-xs font-strong ${softHues[kind]}`;
