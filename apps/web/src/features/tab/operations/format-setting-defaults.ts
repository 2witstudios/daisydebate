import { presetSettingDefaults } from '@daisy/protocol/setting-resolution';
export { presetSettingDefaults } from '@daisy/protocol/setting-resolution';
import type { SettingGraph } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import type { FormatSettingDefaults } from '@daisy/protocol/setting-resolution';

/** Values from the latest approved preset of this exact definition revision. */
export const formatSettingDefaults = (
  graph: Pick<SettingGraph, 'presets'>,
  formatId: string,
  formatVersion: number,
): FormatSettingDefaults => {
  const preset = graph.presets
    .filter(
      (row) => row.formatId === formatId && row.formatVersion === formatVersion,
    )
    .sort((a, b) => b.version - a.version)[0];
  if (!preset)
    throw createAppError('INVARIANT', 'Pinned format has no approved settings');
  return presetSettingDefaults(preset.config);
};
