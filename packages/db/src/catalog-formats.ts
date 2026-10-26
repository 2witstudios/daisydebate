import type {
  DebateSide,
  FormatDefinition,
  RoomConfig,
  SegmentType,
} from '@daisy/protocol';
import { oneOnOneDefinition, oneOnOneRoomConfig } from './reference-formats';

/**
 * The picker's catalog (ADR 0058 extension, FMT-1/FMT-2a): Daisy's standard
 * formats and the league templates whose rules Daisy runs faithfully, as
 * TypeScript the migrations must match. A template is a casual starting
 * point, never rankable on its own; every time below is the league's
 * published default inside bounds wide enough for practice.
 */

const minute = 60_000;
const speechBounds = { min: minute, max: 15 * minute };
const crossExBounds = { min: 30_000, max: 5 * minute };

/** [key, label, type, side, slot, minutes] */
type SegmentRow = readonly [
  string,
  string,
  SegmentType,
  DebateSide,
  number,
  number,
];

/** Every template grants the same interaction and timing latitude. */
function templateDefinition({
  seats,
  segments,
  prepBefore,
}: {
  readonly seats: { readonly perSide: number };
  readonly segments: readonly SegmentRow[];
  readonly prepBefore: readonly SegmentType[];
}): FormatDefinition {
  return {
    version: 1,
    seats: { affirmative: seats.perSide, negative: seats.perSide, judge: 1 },
    segments: segments.map(([key, label, type, side, slot, minutes]) => ({
      key,
      label,
      type,
      side,
      slot,
      defaultDurationMs: minutes * minute,
    })),
    configurable: {
      timing: {
        segmentDurationMs: Object.fromEntries(
          segments.map(([key, , type]) => [
            key,
            type === 'speech' ? speechBounds : crossExBounds,
          ]),
        ),
        countdownMs: { min: 0, max: minute },
      },
      inRoundPrep: {
        budgetMsPerSide: { min: 0, max: 15 * minute },
        spendableBefore: [...prepBefore],
        expiresAtSegment: null,
      },
      preRoundPrep: { durationMs: { min: 0, max: 60 * minute } },
      interaction: {
        crossExModes: ['ordered', 'free'],
        interruptions: {
          modes: ['disabled', 'cross_ex_only', 'enabled'],
          minRemainingMs: { min: 0, max: 5 * minute },
        },
        yield: {
          enabledChoices: [true, false],
          returnsTimeChoices: [true, false],
        },
      },
    },
  };
}

/** A template's starting config: its league prep and questioning, Daisy's usual floor rules. */
function templateConfig(
  prepMinutesPerSide: number,
  crossExMode: 'ordered' | 'free',
): RoomConfig {
  return {
    ...oneOnOneRoomConfig,
    inRoundPrep: {
      enabled: true,
      budgetMsPerSide: prepMinutesPerSide * minute,
    },
    crossExamination: { crossExMode },
  };
}

const ldSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', 'affirmative', 0, 6],
  ['CX1', 'Cross-examination of the affirmative', 'cross_ex', 'negative', 0, 3],
  ['NC', 'Negative constructive', 'speech', 'negative', 0, 7],
  ['CX2', 'Cross-examination of the negative', 'cross_ex', 'affirmative', 0, 3],
  ['1AR', 'First affirmative rebuttal', 'speech', 'affirmative', 0, 4],
  ['NR', 'Negative rebuttal', 'speech', 'negative', 0, 6],
  ['2AR', 'Second affirmative rebuttal', 'speech', 'affirmative', 0, 3],
];

/** Team policy's order; the asker of each cross-ex follows the NCFCA rule (2N, 1A, 1N, 2A). */
const teamPolicySegments = (
  constructive: number,
  rebuttal: number,
): readonly SegmentRow[] => [
  [
    '1AC',
    'First affirmative constructive',
    'speech',
    'affirmative',
    0,
    constructive,
  ],
  [
    'CX1',
    'Cross-examination of the first affirmative',
    'cross_ex',
    'negative',
    1,
    3,
  ],
  ['1NC', 'First negative constructive', 'speech', 'negative', 0, constructive],
  [
    'CX2',
    'Cross-examination of the first negative',
    'cross_ex',
    'affirmative',
    0,
    3,
  ],
  [
    '2AC',
    'Second affirmative constructive',
    'speech',
    'affirmative',
    1,
    constructive,
  ],
  [
    'CX3',
    'Cross-examination of the second affirmative',
    'cross_ex',
    'negative',
    0,
    3,
  ],
  [
    '2NC',
    'Second negative constructive',
    'speech',
    'negative',
    1,
    constructive,
  ],
  [
    'CX4',
    'Cross-examination of the second negative',
    'cross_ex',
    'affirmative',
    1,
    3,
  ],
  ['1NR', 'First negative rebuttal', 'speech', 'negative', 0, rebuttal],
  ['1AR', 'First affirmative rebuttal', 'speech', 'affirmative', 0, rebuttal],
  ['2NR', 'Second negative rebuttal', 'speech', 'negative', 1, rebuttal],
  ['2AR', 'Second affirmative rebuttal', 'speech', 'affirmative', 1, rebuttal],
];

/** Public Forum with the Pro team speaking first as Aff; crossfire is open questioning. */
const publicForumSegments: readonly SegmentRow[] = [
  ['AC1', 'First affirmative constructive', 'speech', 'affirmative', 0, 4],
  ['NC1', 'First negative constructive', 'speech', 'negative', 0, 4],
  ['CF1', 'Crossfire', 'cross_ex', 'affirmative', 0, 3],
  ['AR', 'Affirmative rebuttal', 'speech', 'affirmative', 1, 4],
  ['NR', 'Negative rebuttal', 'speech', 'negative', 1, 4],
  ['CF2', 'Crossfire', 'cross_ex', 'affirmative', 1, 3],
  ['AS', 'Affirmative summary', 'speech', 'affirmative', 0, 3],
  ['NS', 'Negative summary', 'speech', 'negative', 0, 3],
  ['GCF', 'Grand crossfire', 'cross_ex', 'affirmative', 0, 3],
  ['AFF', 'Affirmative final focus', 'speech', 'affirmative', 1, 2],
  ['NFF', 'Negative final focus', 'speech', 'negative', 1, 2],
];

const bigQuestionsSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', 'affirmative', 0, 5],
  ['NC', 'Negative constructive', 'speech', 'negative', 0, 5],
  ['Q1', 'Question segment', 'cross_ex', 'affirmative', 0, 3],
  ['AR', 'Affirmative rebuttal', 'speech', 'affirmative', 0, 4],
  ['NR', 'Negative rebuttal', 'speech', 'negative', 0, 4],
  ['Q2', 'Question segment', 'cross_ex', 'negative', 0, 3],
  ['ACS', 'Affirmative consolidation', 'speech', 'affirmative', 0, 3],
  ['NCS', 'Negative consolidation', 'speech', 'negative', 0, 3],
  ['ART', 'Affirmative rationale', 'speech', 'affirmative', 0, 3],
  ['NRT', 'Negative rationale', 'speech', 'negative', 0, 3],
];

const nsdaManual = {
  rulesEdition: 'NSDA High School Unified Manual 2026–27',
  sourceUrl: 'https://www.speechanddebate.org/?p=81990',
};

export type CatalogFormat = {
  readonly id: string;
  readonly name: string;
  readonly role: 'standard' | 'template';
  readonly family: 'policy' | 'value' | 'parli' | 'other' | null;
  readonly leagues: readonly string[];
  readonly searchTerms: string;
  readonly sortOrder: number;
  readonly rulesEdition: string | null;
  readonly sourceUrl: string | null;
  readonly definition: FormatDefinition;
  readonly preset: RoomConfig;
};

/** Daisy's standards share the one-on-one schedule; Policy and Value differ only in the resolution. */
const standard = (
  id: 'policy' | 'value',
  name: string,
  sortOrder: number,
): CatalogFormat => ({
  id,
  name,
  role: 'standard',
  family: null,
  leagues: [],
  searchTerms: `${id} daisy standard one-on-one`,
  sortOrder,
  rulesEdition: null,
  sourceUrl: null,
  definition: oneOnOneDefinition,
  preset: oneOnOneRoomConfig,
});

const template = (format: Omit<CatalogFormat, 'role'>): CatalogFormat => ({
  ...format,
  role: 'template',
});

export const catalogFormats: readonly CatalogFormat[] = [
  standard('policy', 'Policy', 1),
  standard('value', 'Value', 2),
  template({
    id: 'nsda-ld',
    name: 'NSDA Lincoln-Douglas',
    family: 'value',
    leagues: ['NSDA', 'TFA', 'CHSSA'],
    searchTerms: 'ld lincoln douglas value nsda tfa chssa',
    sortOrder: 10,
    ...nsdaManual,
    definition: templateDefinition({
      seats: { perSide: 1 },
      segments: ldSegments,
      prepBefore: ['speech', 'cross_ex'],
    }),
    preset: templateConfig(4, 'ordered'),
  }),
  template({
    id: 'ncfca-ld',
    name: 'NCFCA Lincoln-Douglas',
    family: 'value',
    leagues: ['NCFCA'],
    searchTerms: 'ld lincoln douglas value ncfca homeschool',
    sortOrder: 11,
    rulesEdition: 'NCFCA Lincoln-Douglas rules',
    sourceUrl:
      'https://ncfca.org/rules/lincoln-douglas-value-speaking-order-and-times/',
    definition: templateDefinition({
      seats: { perSide: 1 },
      segments: ldSegments,
      prepBefore: ['speech'],
    }),
    preset: templateConfig(3, 'ordered'),
  }),
  template({
    id: 'stoa-ld',
    name: 'Stoa Lincoln-Douglas',
    family: 'value',
    leagues: ['Stoa'],
    searchTerms: 'ld lincoln douglas value stoa homeschool',
    sortOrder: 12,
    rulesEdition: 'Stoa Lincoln-Douglas rules 2025–26',
    sourceUrl:
      'https://www.stoausa.org/_files/ugd/559d9d_8775f55d576a4b1289ef201da988d99a.pdf',
    definition: templateDefinition({
      seats: { perSide: 1 },
      segments: ldSegments,
      prepBefore: ['speech', 'cross_ex'],
    }),
    preset: templateConfig(4, 'ordered'),
  }),
  template({
    id: 'nsda-policy',
    name: 'NSDA Policy (CX)',
    family: 'policy',
    leagues: ['NSDA', 'TFA', 'CHSSA'],
    searchTerms: 'policy cx cross examination team nsda tfa chssa',
    sortOrder: 20,
    ...nsdaManual,
    definition: templateDefinition({
      seats: { perSide: 2 },
      segments: teamPolicySegments(8, 5),
      prepBefore: ['speech', 'cross_ex'],
    }),
    preset: templateConfig(8, 'ordered'),
  }),
  template({
    id: 'college-policy',
    name: 'College Policy (NDT)',
    family: 'policy',
    leagues: ['NDT'],
    searchTerms: 'policy cx college ndt ceda',
    sortOrder: 21,
    rulesEdition: 'NDT Standing Rules, December 2025',
    sourceUrl:
      'https://nationaldebatetournament.org/wp-content/uploads/2026/01/Standing-Rules-Revised-December-2025.pdf',
    definition: templateDefinition({
      seats: { perSide: 2 },
      segments: teamPolicySegments(9, 6),
      prepBefore: ['speech', 'cross_ex'],
    }),
    preset: templateConfig(10, 'ordered'),
  }),
  template({
    id: 'ncfca-tp',
    name: 'NCFCA Team Policy',
    family: 'policy',
    leagues: ['NCFCA'],
    searchTerms: 'policy team tp ncfca homeschool',
    sortOrder: 22,
    rulesEdition: 'NCFCA Team Policy rules',
    sourceUrl: 'https://ncfca.org/rules/team-policy-speaking-order-and-times/',
    definition: templateDefinition({
      seats: { perSide: 2 },
      segments: teamPolicySegments(8, 5),
      prepBefore: ['speech'],
    }),
    preset: templateConfig(5, 'ordered'),
  }),
  template({
    id: 'nsda-pf',
    name: 'Public Forum',
    family: 'other',
    leagues: ['NSDA', 'TFA', 'CHSSA'],
    searchTerms: 'pf public forum crossfire pro con nsda tfa chssa',
    sortOrder: 30,
    ...nsdaManual,
    definition: templateDefinition({
      seats: { perSide: 2 },
      segments: publicForumSegments,
      prepBefore: ['speech', 'cross_ex'],
    }),
    preset: templateConfig(3, 'free'),
  }),
  template({
    id: 'nsda-bq',
    name: 'Big Questions',
    family: 'other',
    leagues: ['NSDA'],
    searchTerms: 'bq big questions philosophy nsda',
    sortOrder: 31,
    ...nsdaManual,
    definition: templateDefinition({
      seats: { perSide: 1 },
      segments: bigQuestionsSegments,
      prepBefore: ['speech', 'cross_ex'],
    }),
    preset: templateConfig(3, 'free'),
  }),
];
