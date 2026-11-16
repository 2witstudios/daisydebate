import type { FormatDefinition, FormatSettings } from '@daisy/protocol';
import { oneOnOneDefinition, oneOnOneSettings } from './reference-formats';
import {
  strikeSettings,
  templateSettings,
  templateDefinition,
  withDraw,
} from './catalog-builders';
import {
  bigQuestionsSegments,
  ipdaSegments,
  ldSegments,
  publicForumSegments,
  teamIpdaSegments,
  teamPolicySegments,
} from './catalog-segments';
import { casualTemplates } from './catalog-casual';

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
