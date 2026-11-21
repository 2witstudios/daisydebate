import type { ProtectionLevel } from '@daisy/protocol/protection-level';

export const protectionLevelLabels = {
  independent: 'Independent',
  guided: 'Guided',
  supervised: 'Supervised',
  custom: 'Custom',
} satisfies Record<ProtectionLevel['level'], string>;
