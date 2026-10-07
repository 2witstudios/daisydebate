import type { FormatDefinition, RoomConfig, RoundRules } from '@daisy/protocol';
import { resolveRoomConfiguration } from './resolve-room-configuration';

/**
 * The one-on-one practice format as a definition, and the room config the
 * AI-practice rooms resolve from. The seven-segment schedule and the prep
 * and countdown constants the engine used to hardcode are data here.
 */
export const oneOnOneDefinition: FormatDefinition = {
  version: 1,
  seats: { affirmative: 1, negative: 1, judge: 1 },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: 'CX1',
      label: 'Cross-examination of the affirmative',
      type: 'cross_ex',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 120_000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      type: 'speech',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 360_000,
    },
    {
      key: 'CX2',
      label: 'Cross-examination of the negative',
      type: 'cross_ex',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 120_000,
    },
    {
      key: '1AR',
      label: 'First affirmative rebuttal',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: 'NR',
      label: 'Negative rebuttal',
      type: 'speech',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: '2AR',
      label: 'Second affirmative rebuttal',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 180_000,
    },
  ],
  configurable: {
    timing: {
      segmentDurationMs: {
        AC: { min: 60_000, max: 600_000 },
        CX1: { min: 30_000, max: 300_000 },
        NC: { min: 60_000, max: 600_000 },
        CX2: { min: 30_000, max: 300_000 },
        '1AR': { min: 60_000, max: 600_000 },
        NR: { min: 60_000, max: 600_000 },
        '2AR': { min: 30_000, max: 600_000 },
      },
      countdownMs: { min: 0, max: 60_000 },
    },
    inRoundPrep: {
      budgetMsPerSide: { min: 0, max: 600_000 },
      spendableBefore: ['speech'],
      expiresAtSegment: null,
    },
    preRoundPrep: { durationMs: { min: 0, max: 1_200_000 } },
    interaction: {
      crossExModes: ['ordered', 'free'],
      interruptions: {
        modes: ['disabled', 'cross_ex_only', 'enabled'],
        minRemainingMs: { min: 0, max: 300_000 },
      },
      yield: {
        enabledChoices: [true, false],
        returnsTimeChoices: [true, false],
      },
    },
  },
};

export const practiceConfig: RoomConfig = {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 240_000 },
  speechTiming: {
    countdownMs: 10_000,
    segmentDurationOverrides: {},
  },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: { mode: 'cross_ex_only', minRemainingMs: 30_000 },
  yielding: { allowed: true, returnsTime: true },
};

/** The resolved rules for the practice room; throws when it refuses. */
export const practiceRules = (): RoundRules => {
  const outcome = resolveRoomConfiguration(oneOnOneDefinition, practiceConfig);
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return outcome.rules;
};

/** Sequential segment ids, so projections are deterministic in tests. */
export const sequentialSegmentIds = (): (() => string) => {
  let next = 0;
  return () => {
    next += 1;
    return `segment-${next}`;
  };
};
