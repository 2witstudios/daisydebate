import type { FormatSettings } from '../format-settings';
import type { FormatSettingDefaults } from './resolve-setting';

/** The format-owned fallback values of one actual approved preset. */
export const presetSettingDefaults = (
  config: Pick<
    FormatSettings,
    | 'preRoundPrep'
    | 'inRoundPrep'
    | 'speechTiming'
    | 'interruptions'
    | 'yielding'
  >,
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
