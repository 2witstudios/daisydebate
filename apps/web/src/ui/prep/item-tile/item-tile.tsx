import type { ItemKind } from '../../../features/prep/library/library-item';
import { PrepIcon, type PrepIconName } from '../prep-icon/prep-icon';
import { itemTileClass } from './item-tile-class';

const glyphOf: Readonly<Record<ItemKind, PrepIconName>> = {
  brief: 'doc',
  card: 'card',
  case: 'briefcase',
};

export const kindLabel: Readonly<Record<ItemKind, string>> = {
  brief: 'Brief',
  card: 'Evidence card',
  case: 'Case',
};

/** The icon that stands for a brief, a card or a case. */
export function ItemTile({ kind }: { readonly kind: ItemKind }) {
  return (
    <span className={itemTileClass(kind)}>
      <PrepIcon name={glyphOf[kind]} size={18} />
    </span>
  );
}
