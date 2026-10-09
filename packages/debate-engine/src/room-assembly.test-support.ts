import type { RoomAssemblyState } from '@daisy/protocol';
export const rules = {
  version: 2 as const,
  seats: { affirmative: 1, negative: 1, judge: 0 },
  segments: [
    {
      key: 'A1',
      label: 'Affirmative speech',
      type: 'speech' as const,
      side: 'affirmative' as const,
      slot: 0,
      durationMs: 60_000,
    },
    {
      key: 'N1',
      label: 'Negative speech',
      type: 'speech' as const,
      side: 'negative' as const,
      slot: 0,
      durationMs: 60_000,
    },
  ],
  inRoundPrep: null,
  countdownMs: 0,
  interaction: {
    crossExMode: 'ordered' as const,
    yield: null,
    interruptions: null,
  },
};
export const state = (): RoomAssemblyState => ({
  id: 'room',
  version: 4,
  changeVersion: 1,
  title: 'Room',
  topic: 'Motion',
  visibility: 'public',
  hostActorId: 'host',
  hostLabel: 'Host',
  status: 'ready',
  formatId: 'format',
  formatVersion: 1,
  presetVersion: null,
  competitionType: 'casual',
  length: 'full',
  definition: {
    version: 1,
    seats: rules.seats,
    segments: rules.segments.map(({ durationMs, ...segment }) => ({
      ...segment,
      defaultDurationMs: durationMs,
    })),
    configurable: {
      preRoundPrep: null,
      inRoundPrep: null,
      timing: {
        countdownMs: { min: 0, max: 0 },
        segmentDurationMs: {
          A1: { min: 60_000, max: 60_000 },
          N1: { min: 60_000, max: 60_000 },
        },
      },
      interaction: {
        crossExModes: ['ordered'],
        interruptions: null,
        yield: null,
      },
    },
  },
  config: {
    preRoundPrep: { enabled: false },
    inRoundPrep: { enabled: false },
    speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
    crossExamination: { crossExMode: 'ordered' },
    interruptions: null,
    yielding: null,
  },
  executionPlan: { preRoundPrep: { enabled: false } },
  rules,
  participants: [
    {
      id: 'p1',
      actorId: 'host',
      label: 'Host',
      kind: 'human',
      role: 'affirmative',
      slot: 0,
      eligible: true,
      consentVersion: 0,
      consentCommandId: 'r1',
    },
    {
      id: 'p2',
      actorId: 'other',
      label: 'Other',
      kind: 'human',
      role: 'negative',
      slot: 0,
      eligible: true,
      consentVersion: 0,
      consentCommandId: 'r2',
    },
  ],
  prepStartedAt: null,
  prepRemainingMs: null,
  roundRef: null,
});
export const edges = {
  now: '2026-10-09T00:00:00.000Z',
  participantId: 'new-seat',
  formatId: 'new-format',
  target: null,
};
export const consent = { available: true, readyActorIds: ['host', 'other'] };
