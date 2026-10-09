import { resolveRoomConfiguration } from '@daisy/debate-engine';
import type { RoomView } from '@daisy/protocol';
import type { RoomTemplate } from './read-catalog';

/** Explicit legal-choice fixture, never a production template or default. */
export const unequalTemplate = {
  formatId: 'test-unequal-template',
  formatVersion: 7,
  label: 'Unequal team template',
  definition: {
    version: 1,
    seats: { affirmative: 2, negative: 3, judge: 1 },
    segments: [
      {
        key: 'N3',
        label: 'Third negative reply',
        type: 'speech',
        side: 'negative',
        slot: 2,
        defaultDurationMs: 120000,
      },
    ],
    configurable: {
      timing: {
        segmentDurationMs: { N3: { min: 60000, max: 180000 } },
        countdownMs: { min: 0, max: 5000 },
      },
      preRoundPrep: { durationMs: { min: 60000, max: 600000 } },
      inRoundPrep: {
        budgetMsPerSide: { min: 0, max: 900000 },
        spendableBefore: ['speech'],
        expiresAtSegment: null,
      },
      interaction: {
        crossExModes: ['free'],
        interruptions: {
          modes: ['disabled'],
          minRemainingMs: { min: 0, max: 10000 },
        },
        yield: { enabledChoices: [false], returnsTimeChoices: [true] },
      },
    },
  },
  presets: [],
  defaultConfig: {
    preRoundPrep: { enabled: true, durationMs: 321000 },
    inRoundPrep: { enabled: true, budgetMsPerSide: 887000 },
    speechTiming: { countdownMs: 444, segmentDurationOverrides: { N3: 98765 } },
    crossExamination: { crossExMode: 'free' },
    interruptions: { mode: 'disabled', minRemainingMs: 1234 },
    yielding: { allowed: false, returnsTime: true },
  },
} satisfies RoomTemplate;

const compiled = resolveRoomConfiguration(
  unequalTemplate.definition,
  unequalTemplate.defaultConfig,
);
if (!compiled.ok) throw new Error('Room consumer fixture must compile');
export const assemblySnapshot = {
  id: 'i'.repeat(24),
  version: 3,
  changeVersion: 3,
  title: 'Persisted room',
  topic: 'Persisted debate topic',
  visibility: 'unlisted',
  hostActorId: 'o'.repeat(24),
  hostLabel: 'Host member',
  status: 'assembling',
  formatId: unequalTemplate.formatId,
  formatVersion: unequalTemplate.formatVersion,
  presetVersion: null,
  competitionType: 'casual',
  length: 'full',
  definition: unequalTemplate.definition,
  config: unequalTemplate.defaultConfig,
  executionPlan: compiled.roomPlan,
  rules: compiled.rules,
  participants: [],
  readiness: { available: true, version: 3, readyActorIds: [] },
  prep: { startedAt: null, remainingMs: null, finished: false },
  capabilities: {
    host: true,
    canEdit: true,
    canClaimSeat: true,
    canReady: false,
    canStartPrep: false,
    canFinishPrep: false,
    canStart: false,
  },
  startRefusal: 'incomplete-cast',
  roundRef: null,
} satisfies RoomView;
