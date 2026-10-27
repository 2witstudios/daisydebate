import type { ItemKind } from '../../../features/prep/library/library-item';
import { Icon, type IconName } from '../../components/icon/icon';
import { itemTileClass } from './item-tile-class';

const glyphOf: Readonly<Record<ItemKind, IconName>> = {
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
      <Icon name={glyphOf[kind]} size={18} />
    </span>
  );
}
