import {
  itemHref,
  itemSubtitle,
  type ItemKind,
  type LibraryItem,
  type Visibility,
} from './library-item';
import { ago } from '../relative-time';

/** What one library row shows; built from an item and the injected `now`. */
export type LibraryRow = {
  readonly id: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly subtitle: string;
  readonly href: string;
  readonly tags: readonly string[];
  readonly visibility: Visibility;
  /** "Edited 2 days ago", "Used in 3", "Not used yet". */
  readonly meta: string;
};

export const usedLabel = (usedIn: number): string =>
  usedIn === 0 ? 'Not used yet' : `Used in ${usedIn}`;

export function toRow(item: LibraryItem, now: string): LibraryRow {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: itemSubtitle(item),
    href: itemHref(item),
    tags: item.tags,
    visibility: item.visibility,
    meta:
      item.kind === 'card'
        ? usedLabel(item.usedIn)
        : `Edited ${ago(now, item.editedAt)}`,
  };
}
