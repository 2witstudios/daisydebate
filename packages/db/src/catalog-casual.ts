import {
  affirmativeSide,
  fourTeams,
  negativeSide,
  sideSeat,
  twoSides,
  type SeatRef,
} from '@daisy/protocol/seats';
import { type FormatDefinition } from '@daisy/protocol/format';
import { type FormatSettings } from '@daisy/protocol/format-settings';
import type { CatalogFormat } from './catalog-formats';

/**
 * Daisy's casual templates (TAB-6.18): the shapes beyond one debater a side
 * and one judge that an ordinary Room runs. Each is a casual starting point
 * of Daisy's own, never a league's and never rankable: a panel of three
 * judges, four teams ranked, a speech section ranked by speaker, and an
 * open conversation nobody judges.
 */

const minute = 60_000;
const speechBounds = { min: 30_000, max: 15 * minute };

type Segment = FormatDefinition['segments'][number];

/** One seat's speech of `minutes`. */
const speech = (
  key: string,
  label: string,
  seat: SeatRef,
  minutes: number,
): Segment => ({
  key,
  label,
  type: 'speech',
  speak: { rights: 'one', seat },
  defaultDurationMs: minutes * minute,
});

/** No prep, draw or interruption; a speaker may yield where there are speeches. */
const casualCapabilities = (
  segments: readonly Segment[],
  yieldable: boolean,
): FormatDefinition['configurable'] => ({
  timing: {
    segmentDurationMs: Object.fromEntries(
      segments.map((segment) => [segment.key, speechBounds]),
    ),
    countdownMs: { min: 0, max: minute },
  },
  inRoundPrep: null,
  preRoundPrep: null,
  resolutionDraw: null,
  interaction: {
    pointsOfInformation: null,
    yield: yieldable
      ? { enabledChoices: [true, false], returnsTimeChoices: [true, false] }
      : null,
  },
});

/** The settings every casual template starts from: nothing to spend, a ten-second countdown. */
const casualSettings = (yieldable: boolean): FormatSettings => ({
  preRoundPrep: { enabled: false },
  resolutionDraw: { enabled: false },
  inRoundPrep: { enabled: false },
  speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
  pointsOfInformation: null,
  yielding: yieldable ? { allowed: true, returnsTime: true } : null,
});

const casual = (
  format: Pick<CatalogFormat, 'id' | 'name' | 'searchTerms' | 'sortOrder'> & {
    readonly definition: Omit<FormatDefinition, 'configurable' | 'version'>;
    readonly yieldable: boolean;
  },
): CatalogFormat => ({
  id: format.id,
  name: format.name,
  role: 'template',
  family: 'other',
  leagues: [],
  searchTerms: format.searchTerms,
  sortOrder: format.sortOrder,
  rulesEdition: null,
  sourceUrl: null,
  definition: {
    version: 2,
    ...format.definition,
    configurable: casualCapabilities(
      format.definition.segments,
      format.yieldable,
    ),
  },
  preset: casualSettings(format.yieldable),
});

/** Two debaters before a panel of three judges; the majority of ballots decides. */
const panelDebate = casual({
  id: 'panel-debate',
  name: 'Three-judge debate',
  searchTerms: 'panel three judges majority debate casual',
  sortOrder: 50,
  yieldable: true,
  definition: {
    sides: [...twoSides],
    seats: {
      sides: { [affirmativeSide]: 1, [negativeSide]: 1 },
      speakers: 0,
      judges: 3,
      moderators: 0,
    },
    outcome: { kind: 'winner' },
    segments: [
      speech('AC', 'Affirmative constructive', sideSeat(affirmativeSide), 4),
      speech('NC', 'Negative constructive', sideSeat(negativeSide), 4),
      speech('AR', 'Affirmative rebuttal', sideSeat(affirmativeSide), 3),
      speech('NR', 'Negative rebuttal', sideSeat(negativeSide), 3),
    ],
  },
});

/** Four teams of one, opening and closing on each bench; the judge ranks the teams. */
const fourTeamDebate = casual({
  id: 'four-team',
  name: 'Four-team debate',
  searchTerms: 'four teams ranked opening closing government opposition',
  sortOrder: 51,
  yieldable: true,
  definition: {
    sides: [...fourTeams],
    seats: {
      sides: Object.fromEntries(fourTeams.map((team) => [team.key, 1])),
      speakers: 0,
      judges: 1,
      moderators: 0,
    },
    outcome: { kind: 'ranking', of: 'sides' },
    segments: fourTeams.map((team) =>
      speech(team.short, team.label, sideSeat(team.key), 5),
    ),
  },
});

const sectionSpeakers = 6;

/** Six speakers give one speech each; the judge ranks the speakers. */
const speechSection = casual({
  id: 'speech-section',
  name: 'Speech section',
  searchTerms: 'speech section six speakers ranked individual events',
  sortOrder: 52,
  yieldable: true,
  definition: {
    sides: [],
    seats: { sides: {}, speakers: sectionSpeakers, judges: 1, moderators: 0 },
    outcome: { kind: 'ranking', of: 'speakers' },
    segments: Array.from({ length: sectionSpeakers }, (_, slot) =>
      speech(
        `S${slot + 1}`,
        `Speaker ${slot + 1}`,
        { kind: 'speaker', slot },
        5,
      ),
    ),
  },
});

/** Two people talk with both microphones open; nobody judges and nothing is decided. */
const openConversation = casual({
  id: 'open-conversation',
  name: 'Open conversation',
  searchTerms: 'open conversation discussion two people unjudged',
  sortOrder: 53,
  yieldable: false,
  definition: {
    sides: [],
    seats: { sides: {}, speakers: 2, judges: 0, moderators: 0 },
    outcome: { kind: 'none' },
    segments: [
      {
        key: 'OPEN',
        label: 'Conversation',
        type: 'open',
        speak: { rights: 'all', lead: null },
        defaultDurationMs: 10 * minute,
      },
    ],
  },
});

export const casualTemplates: readonly CatalogFormat[] = [
  panelDebate,
  fourTeamDebate,
  speechSection,
  openConversation,
];

/** Their ids: the golden two-sided corpus predates them (TAB-6.1). */
export const casualTemplateIds: readonly string[] = casualTemplates.map(
  (format) => format.id,
);
