import type { FormatDefinition } from '@daisy/protocol/format';
import {
  pointsOfInformationBounds,
  type FormatSettings,
} from '@daisy/protocol/format-settings';
import { oneOnOneDefinition, oneOnOneSettings } from './reference-formats';
import { casualTemplates } from './catalog-casual';
import { affirmativeSide, negativeSide, twoSides } from '@daisy/protocol/seats';
import { type SegmentType } from '@daisy/protocol/format';
import { sideSeat, type SeatRef } from '@daisy/protocol/seats';

/**
 * How catalog entries are built (FMT-2a, FMT-2b): a template's definition
 * and starting config, and the resolution strike a draw format adds.
 */

const minute = 60_000;
const speechBounds = { min: minute, max: 15 * minute };
const crossExBounds = { min: 30_000, max: 5 * minute };

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
    version: 2,
    sides: [...twoSides],
    seats: {
      sides: {
        [affirmativeSide]: seats.perSide,
        [negativeSide]: seats.perSide,
      },
      speakers: 0,
      judges: 1,
      moderators: 0,
    },
    outcome: { kind: 'winner' },
    segments: segments.map(([key, label, type, seat, minutes]) => ({
      key,
      label,
      type,
      // A speech is its speaker's; in cross-ex every debater speaks and the asker leads.
      speak:
        type === 'speech'
          ? { rights: 'one' as const, seat }
          : { rights: 'all' as const, lead: seat },
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
      // A league with no prep during the round (IPDA) offers none.
      inRoundPrep: prepBefore.length
        ? {
            budgetMsPerSide: { min: 0, max: 15 * minute },
            spendableBefore: [...prepBefore],
            expiresAtSegment: null,
          }
        : null,
      preRoundPrep: { durationMs: { min: 0, max: 60 * minute } },
      resolutionDraw: null,
      interaction: {
        pointsOfInformation: pointsOfInformationBounds,
        yield: {
          enabledChoices: [true, false],
          returnsTimeChoices: [true, false],
        },
      },
    },
  };
}

/** A template's settings: its league prep, Daisy's usual floor rules. */
function templateSettings(prepMinutesPerSide: number): FormatSettings {
  return {
    ...oneOnOneSettings,
    inRoundPrep: {
      enabled: true,
      budgetMsPerSide: prepMinutesPerSide * minute,
    },
  };
}

/** The strike latitude a draw format grants (FMT-7): a host may draw 3–7 from either source. */
const drawCapability: NonNullable<
  FormatDefinition['configurable']['resolutionDraw']
> = {
  drawSize: { min: 3, max: 7 },
  strikeWindowMs: { min: 15_000, max: 3 * minute },
  firstStrikers: [negativeSide, affirmativeSide],
  sources: ['bank', 'host'],
};

const withDraw = (definition: FormatDefinition): FormatDefinition => ({
  ...definition,
  configurable: { ...definition.configurable, resolutionDraw: drawCapability },
});

/**
 * The IPDA-style strike (IPDA Bylaws Art. 1 F): five bank resolutions of
 * any kind, the Negative strikes first, then fixed prep and none during
 * the round. The 60 s strike window is Daisy's; IPDA leaves it to the room.
 */
const strikeSettings = (
  base: FormatSettings,
  prepMinutes: number,
): FormatSettings => ({
  ...base,
  preRoundPrep: { enabled: true, durationMs: prepMinutes * minute },
  inRoundPrep: { enabled: false },
  resolutionDraw: {
    enabled: true,
    drawSize: 5,
    strikeWindowMs: minute,
    firstStriker: negativeSide,
    source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
  },
});

/**
 * The league templates' speech orders (FMT-2a), as each league's rules
 * publish them; catalog-formats.ts builds definitions from these rows.
 */

/** [key, label, type, seat, minutes]: the seat speaks a speech, or asks in cross-ex. */
type SegmentRow = readonly [string, string, SegmentType, SeatRef, number];

/** The two-sided preset's seats, by slot. */
const aff = (slot: number) => sideSeat(affirmativeSide, slot);
const neg = (slot: number) => sideSeat(negativeSide, slot);

const ldSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', aff(0), 6],
  ['CX1', 'Cross-examination of the affirmative', 'cross_ex', neg(0), 3],
  ['NC', 'Negative constructive', 'speech', neg(0), 7],
  ['CX2', 'Cross-examination of the negative', 'cross_ex', aff(0), 3],
  ['1AR', 'First affirmative rebuttal', 'speech', aff(0), 4],
  ['NR', 'Negative rebuttal', 'speech', neg(0), 6],
  ['2AR', 'Second affirmative rebuttal', 'speech', aff(0), 3],
];

/** Constructive, cross-ex and rebuttal minutes of a two-person team round, in speaking order. */
type TeamTimes = {
  readonly constructives: readonly [number, number, number, number];
  readonly crossEx: number;
  readonly rebuttals: readonly [number, number, number, number];
};

/**
 * The two-person team order shared by team policy and Team IPDA: four
 * constructives, each followed by its cross-ex, then neg-first rebuttals.
 * The askers follow the NCFCA and IPDA rule (2N, 1A, 1N, 2A).
 */
const teamSegments = ({
  constructives: [c1, c2, c3, c4],
  crossEx,
  rebuttals: [r1, r2, r3, r4],
}: TeamTimes): readonly SegmentRow[] => [
  ['1AC', 'First affirmative constructive', 'speech', aff(0), c1],
  [
    'CX1',
    'Cross-examination of the first affirmative',
    'cross_ex',
    neg(1),
    crossEx,
  ],
  ['1NC', 'First negative constructive', 'speech', neg(0), c2],
  [
    'CX2',
    'Cross-examination of the first negative',
    'cross_ex',
    aff(0),
    crossEx,
  ],
  ['2AC', 'Second affirmative constructive', 'speech', aff(1), c3],
  [
    'CX3',
    'Cross-examination of the second affirmative',
    'cross_ex',
    neg(0),
    crossEx,
  ],
  ['2NC', 'Second negative constructive', 'speech', neg(1), c4],
  [
    'CX4',
    'Cross-examination of the second negative',
    'cross_ex',
    aff(1),
    crossEx,
  ],
  ['1NR', 'First negative rebuttal', 'speech', neg(0), r1],
  ['1AR', 'First affirmative rebuttal', 'speech', aff(0), r2],
  ['2NR', 'Second negative rebuttal', 'speech', neg(1), r3],
  ['2AR', 'Second affirmative rebuttal', 'speech', aff(1), r4],
];

/** Team policy: equal constructives and rebuttals, three-minute cross-ex. */
const teamPolicySegments = (
  constructive: number,
  rebuttal: number,
): readonly SegmentRow[] =>
  teamSegments({
    constructives: [constructive, constructive, constructive, constructive],
    crossEx: 3,
    rebuttals: [rebuttal, rebuttal, rebuttal, rebuttal],
  });

/** IPDA Bylaws Art. 1 H, team debate format. */
const teamIpdaSegments = teamSegments({
  constructives: [4, 5, 5, 4],
  crossEx: 2,
  rebuttals: [3, 4, 4, 3],
});

/** IPDA Bylaws Art. 1 H, individual debate format. */
const ipdaSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', aff(0), 5],
  ['CX1', 'Cross-examination of the affirmative', 'cross_ex', neg(0), 2],
  ['NC', 'Negative constructive', 'speech', neg(0), 6],
  ['CX2', 'Cross-examination of the negative', 'cross_ex', aff(0), 2],
  ['AR', 'Affirmative rebuttal', 'speech', aff(0), 3],
  ['NR', 'Negative rebuttal', 'speech', neg(0), 5],
  ['AS', 'Affirmative summary', 'speech', aff(0), 3],
];

/** Public Forum with the Pro team speaking first as Aff; crossfire is open questioning. */
const publicForumSegments: readonly SegmentRow[] = [
  ['AC1', 'First affirmative constructive', 'speech', aff(0), 4],
  ['NC1', 'First negative constructive', 'speech', neg(0), 4],
  ['CF1', 'Crossfire', 'cross_ex', aff(0), 3],
  ['AR', 'Affirmative rebuttal', 'speech', aff(1), 4],
  ['NR', 'Negative rebuttal', 'speech', neg(1), 4],
  ['CF2', 'Crossfire', 'cross_ex', aff(1), 3],
  ['AS', 'Affirmative summary', 'speech', aff(0), 3],
  ['NS', 'Negative summary', 'speech', neg(0), 3],
  ['GCF', 'Grand crossfire', 'cross_ex', aff(0), 3],
  ['AFF', 'Affirmative final focus', 'speech', aff(1), 2],
  ['NFF', 'Negative final focus', 'speech', neg(1), 2],
];

const bigQuestionsSegments: readonly SegmentRow[] = [
  ['AC', 'Affirmative constructive', 'speech', aff(0), 5],
  ['NC', 'Negative constructive', 'speech', neg(0), 5],
  ['Q1', 'Question segment', 'cross_ex', aff(0), 3],
  ['AR', 'Affirmative rebuttal', 'speech', aff(0), 4],
  ['NR', 'Negative rebuttal', 'speech', neg(0), 4],
  ['Q2', 'Question segment', 'cross_ex', neg(0), 3],
  ['ACS', 'Affirmative consolidation', 'speech', aff(0), 3],
  ['NCS', 'Negative consolidation', 'speech', neg(0), 3],
  ['ART', 'Affirmative rationale', 'speech', aff(0), 3],
  ['NRT', 'Negative rationale', 'speech', neg(0), 3],
];

export { casualTemplateIds } from './catalog-casual';

/**
 * The picker's catalog (ADR 0058 extension, FMT-1/FMT-2a, ADR 0142): Daisy's
 * one standard, Freestyle, and the league templates whose rules Daisy runs faithfully, as
 * TypeScript the migrations must match. A template is a casual starting
 * point, never rankable on its own; every time below is the league's
 * published default inside bounds wide enough for practice. Daisy's own
 * casual templates (TAB-6.18) follow the league ones.
 */

const ipdaBylaws = {
  rulesEdition: 'IPDA Constitution and Bylaws (revised 2018)',
  sourceUrl:
    'https://www.ipdadebate.info/s/ipda_constitution_revised_2018-1.pdf',
};

const nsdaManual = {
  rulesEdition: 'NSDA High School Unified Manual 2026–27',
  sourceUrl: 'https://www.speechanddebate.org/?p=81990',
};

/** What the picker offers: Daisy's standard and league templates. */
export const catalogRoles = ['standard', 'template'] as const;
/** The league browser's tabs. */
export const catalogFamilies = ['policy', 'value', 'parli', 'other'] as const;
/** The standard's format id, which is also its identity and ladder (ADR 0142). */
export const standardFormatIds = ['freestyle'] as const;

export type CatalogFormat = {
  readonly id: string;
  readonly name: string;
  readonly role: (typeof catalogRoles)[number];
  readonly family: (typeof catalogFamilies)[number] | null;
  readonly leagues: readonly string[];
  readonly searchTerms: string;
  readonly sortOrder: number;
  readonly rulesEdition: string | null;
  readonly sourceUrl: string | null;
  readonly definition: FormatDefinition;
  readonly preset: FormatSettings;
};

/**
 * Freestyle, Daisy's one standard (FMT-2b, ADR 0142): the one-on-one
 * schedule, its resolution struck from five drawn from Daisy's bank, then
 * 20 minutes of prep.
 */
const freestyle: CatalogFormat = {
  id: 'freestyle',
  name: 'Freestyle',
  role: 'standard',
  family: null,
  leagues: [],
  searchTerms: 'freestyle daisy standard one-on-one',
  sortOrder: 3,
  rulesEdition: null,
  sourceUrl: null,
  definition: withDraw(oneOnOneDefinition),
  preset: strikeSettings(oneOnOneSettings, 20),
};

const template = (format: Omit<CatalogFormat, 'role'>): CatalogFormat => ({
  ...format,
  role: 'template',
});

export const catalogFormats: readonly CatalogFormat[] = [
  freestyle,
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
    preset: templateSettings(4),
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
    preset: templateSettings(3),
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
    preset: templateSettings(4),
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
    preset: templateSettings(8),
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
    preset: templateSettings(10),
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
    preset: templateSettings(5),
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
    preset: templateSettings(3),
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
    preset: templateSettings(3),
  }),
  template({
    id: 'ipda',
    name: 'IPDA',
    family: 'parli',
    leagues: ['IPDA'],
    searchTerms: 'ipda public debate parli strike impromptu college',
    sortOrder: 40,
    ...ipdaBylaws,
    definition: withDraw(
      templateDefinition({
        seats: { perSide: 1 },
        segments: ipdaSegments,
        prepBefore: [],
      }),
    ),
    preset: strikeSettings(templateSettings(0), 30),
  }),
  template({
    id: 'team-ipda',
    name: 'Team IPDA',
    family: 'parli',
    leagues: ['IPDA'],
    searchTerms: 'ipda team public debate parli strike college',
    sortOrder: 41,
    ...ipdaBylaws,
    definition: withDraw(
      templateDefinition({
        seats: { perSide: 2 },
        segments: teamIpdaSegments,
        prepBefore: [],
      }),
    ),
    preset: strikeSettings(templateSettings(0), 30),
  }),
  ...casualTemplates,
];
