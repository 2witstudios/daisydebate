import { resolveRoomConfiguration } from '@daisy/debate-engine';
import {
  twoSides,
  freezeRoomConfig,
  freezeRoomExecutionPlan,
  type RoomListEntry,
  type RoomView,
} from '@daisy/protocol';
import { catalogFormats } from '@daisy/db/catalog-formats';
import type { RoomTemplate } from './read-catalog';

const freestyle = catalogFormats.find((format) => format.id === 'freestyle')!;
/** Freestyle, Daisy's one standard, as the catalog offers it (ADR 0142). */
export const freestyleChoice: RoomTemplate = {
  formatId: 'freestyle',
  formatVersion: 1,
  label: 'Freestyle',
  role: 'standard',
  family: null,
  leagues: [],
  searchTerms: freestyle.searchTerms,
  sortOrder: freestyle.sortOrder,
  rulesEdition: null,
  sourceUrl: null,
  definition: freestyle.definition,
  preset: { version: 1, config: freestyle.preset, rankedEligible: true },
};

/** Explicit legal-choice fixture, never a production template or default. */
export const unequalTemplate = {
  formatId: 'test-unequal-template',
  formatVersion: 7,
  label: 'Unequal team template',
  role: 'template',
  family: 'other',
  leagues: ['Test League'],
  searchTerms: 'unequal test',
  sortOrder: 99,
  rulesEdition: 'Test rules',
  sourceUrl: 'https://example.test/rules',
  definition: {
    version: 2,
    sides: [...twoSides],
    seats: {
      sides: { affirmative: 2, negative: 3 },
      speakers: 0,
      judges: 1,
      moderators: 0,
    },
    outcome: { kind: 'winner' },
    segments: [
      {
        key: 'N3',
        label: 'Third negative reply',
        type: 'speech',
        speak: {
          rights: 'one',
          seat: { kind: 'side', side: 'negative', slot: 2 },
        },
        defaultDurationMs: 120000,
      },
      {
        key: 'A1',
        label: 'Affirmative opening',
        type: 'speech',
        speak: {
          rights: 'one',
          seat: { kind: 'side', side: 'affirmative', slot: 0 },
        },
        defaultDurationMs: 60000,
      },
    ],
    configurable: {
      timing: {
        segmentDurationMs: {
          N3: { min: 60000, max: 180000 },
          A1: { min: 60000, max: 180000 },
        },
        countdownMs: { min: 0, max: 5000 },
      },
      preRoundPrep: { durationMs: { min: 60000, max: 600000 } },
      resolutionDraw: null,
      inRoundPrep: {
        budgetMsPerSide: { min: 0, max: 900000 },
        spendableBefore: ['speech'],
        expiresAtSegment: null,
      },
      interaction: {
        interruptions: {
          modes: ['disabled'],
          minRemainingMs: { min: 0, max: 10000 },
        },
        yield: { enabledChoices: [false], returnsTimeChoices: [true] },
      },
    },
  },
  preset: {
    rankedEligible: false,
    version: 5,
    config: {
      preRoundPrep: { enabled: true, durationMs: 321000 },
      resolutionDraw: { enabled: false },
      inRoundPrep: { enabled: true, budgetMsPerSide: 887000 },
      speechTiming: {
        countdownMs: 444,
        segmentDurationOverrides: { N3: 98765 },
      },
      interruptions: { mode: 'disabled', minRemainingMs: 1234 },
      yielding: { allowed: false, returnsTime: true },
    },
  },
} satisfies RoomTemplate;

const compiled = resolveRoomConfiguration(
  unequalTemplate.definition,
  unequalTemplate.preset.config,
);
if (!compiled.ok) throw new Error('Room consumer fixture must compile');
export const assemblySnapshot = {
  id: 'i'.repeat(24),
  version: 3,
  changeVersion: 3,
  title: 'Persisted room',
  topic: 'Persisted debate topic',
  visibility: 'public',
  hostActorId: 'o'.repeat(24),
  hostLabel: 'Host member',
  aiJudgeSeating: null,
  contentWaiver: null,
  captureOffer: null,
  capture: null,
  captureNotice: null,
  postRoundCall: false,
  botAdmission: null,
  watchRoundId: null,
  status: 'assembling',
  formatId: unequalTemplate.formatId,
  formatVersion: unequalTemplate.formatVersion,
  presetVersion: null,
  format: {
    name: unequalTemplate.label,
    role: 'template',
    leagues: unequalTemplate.leagues,
    basis: {
      formatId: unequalTemplate.formatId,
      name: unequalTemplate.label,
      formatVersion: unequalTemplate.formatVersion,
      presetVersion: unequalTemplate.preset.version,
      strikes: false,
    },
    standing: {
      kind: 'custom',
      basis: { formatId: unequalTemplate.formatId, role: 'template' },
      changes: [],
    },
  },
  competitionType: 'casual',
  definition: unequalTemplate.definition,
  config: freezeRoomConfig(unequalTemplate.preset.config),
  executionPlan: freezeRoomExecutionPlan(compiled.roomPlan),
  authoredDrawSource: null,
  seatsHeldFromViewer: { side: 0, speaker: 0, judge: 0, moderator: 0 },
  invitations: [],
  rules: compiled.rules,
  teamOneSide: null,
  participants: [],
  readiness: { available: true, version: 3, readyActorIds: [] },
  capabilities: {
    host: true,
    canEdit: true,
    canClaimSeat: true,
    canReady: false,
    canStart: false,
  },
  startRefusal: 'incomplete-cast',
  roundRef: null,
  division: 'open',
} satisfies RoomView;

/** One pending invitation: the host asked @coach to judge. */
export const pendingInvitation = {
  id: 'i'.repeat(24),
  seat: 'judge',
  invitee: 'coach',
  inviter: 'host',
  expiresAt: '2026-11-11T12:00:00.000Z',
} as const satisfies RoomView['invitations'][number];

/** A native create submission naming a stored ranked preset. */
export const rankedCreateForm = (visibility = 'public') => {
  const fields = new FormData();
  fields.set('commandId', 'h'.repeat(24));
  fields.set('title', 'My room');
  fields.set('resolutionMethod', 'custom');
  fields.set('customResolution', 'A real topic');
  fields.set('visibility', visibility);
  fields.set(
    'selection',
    JSON.stringify({
      kind: 'ranked',
      formatId: 'stored-format',
      formatVersion: 2,
      presetVersion: 3,
    }),
  );
  return fields;
};

type ListedFacts = Pick<
  RoomListEntry,
  | 'id'
  | 'version'
  | 'title'
  | 'topic'
  | 'visibility'
  | 'hostActorId'
  | 'hostLabel'
  | 'status'
  | 'competitionType'
>;
/** A seated viewer's discovery entry for a Room, with fixed discovery facts. */
export const seatedListingEntry = ({
  id,
  version,
  title,
  topic,
  visibility,
  hostActorId,
  hostLabel,
  status,
  competitionType,
}: ListedFacts): RoomListEntry => ({
  id,
  version,
  title,
  topic,
  visibility,
  hostActorId,
  hostLabel,
  status,
  competitionType,
  seated: true,
  roundRef: null,
  formatLabel: 'Foundation',
  seatsTaken: 1,
  seatCount: 2,
  waitingSince: '2026-10-09T00:00:00.000Z',
  live: null,
  hostRating: null,
  division: 'open',
  openJudgeSeats: 0,
});
