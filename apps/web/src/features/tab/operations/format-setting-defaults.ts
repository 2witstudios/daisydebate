import type { FormatSettings } from '@daisy/protocol';
import type { SettingGraph } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import type { FormatSettingDefaults } from '@daisy/protocol/setting-resolution';

/** Values from the latest approved preset of this exact definition revision. */
export const formatSettingDefaults = (
  graph: SettingGraph,
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

/** The format-owned fallback values of one actual approved preset. */
export const presetSettingDefaults = (
  config: FormatSettings,
): FormatSettingDefaults => {
  return {
    'room.timing': {
      preRoundPrepMs: config.preRoundPrep.enabled
        ? config.preRoundPrep.durationMs
        : 0,
      inRoundPrepMsPerSide: config.inRoundPrep.enabled
        ? config.inRoundPrep.budgetMsPerSide
        : 0,
      countdownMs: config.speechTiming.countdownMs,
    },
    'room.floor': {
      interruptions: config.interruptions,
      yielding: config.yielding,
    },
  };
};
