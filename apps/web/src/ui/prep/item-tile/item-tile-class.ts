import type { ItemKind } from '../../../features/prep/library-item';

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
