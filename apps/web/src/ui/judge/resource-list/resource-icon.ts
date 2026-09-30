import type { ResourceKind } from '../../../features/judge/resources';
import type { IconName } from '../../components/icon/icon';

const icons: Readonly<Record<ResourceKind, IconName>> = {
  guide: 'book',
  criteria: 'check',
  examples: 'message',
  conflicts: 'alert',
  practice: 'gavel',
  rating: 'chart',
};

export const resourceIcon = (kind: ResourceKind): IconName => icons[kind];
