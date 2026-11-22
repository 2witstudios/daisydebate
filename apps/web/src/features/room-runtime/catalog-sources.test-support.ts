import type { FormatSelectionFacts } from '@daisy/protocol/format-standing';
import {
  foundationSettings,
  foundationDefinition,
} from '@daisy/db/reference-formats';
import { catalogFormats } from '@daisy/db/catalog-formats';

/** Freestyle, Daisy's one standard, as the catalog seeds it (ADR 0142). */
const freestyle = catalogFormats.find((format) => format.id === 'freestyle');
if (freestyle === undefined) throw new Error('The catalog seeds Freestyle');

/** Catalog sources as the store lists them: role-bearing formats at their canonical presets. */
export const catalog = [
  {
    id: 'freestyle',
    name: 'Freestyle',
    version: 1,
    role: 'standard' as const,
    family: null,
    leagues: [],
    searchTerms: freestyle.searchTerms,
    sortOrder: freestyle.sortOrder,
    rulesEdition: null,
    sourceUrl: null,
    definition: freestyle.definition,
    preset: {
      rankedEligible: true,
      formatId: 'freestyle',
      version: 1,
      formatVersion: 1,
      config: freestyle.preset,
    },
  },
  {
    id: 'proof-template',
    name: 'Proof template',
    version: 1,
    role: 'template' as const,
    family: 'other' as const,
    leagues: ['Proof League'],
    searchTerms: 'proof',
    sortOrder: 30,
    rulesEdition: 'Proof rules',
    sourceUrl: 'https://example.test/rules',
    definition: foundationDefinition,
    preset: {
      rankedEligible: false,
      formatId: 'proof-template',
      version: 2,
      formatVersion: 1,
      config: foundationSettings,
    },
  },
];

/** The selection facts the store reports for the Freestyle standard's current tuple. */
export const freestyleFacts: FormatSelectionFacts = {
  format: {
    id: 'freestyle',
    name: 'Freestyle',
    leagues: [],
    catalogOwned: true,
    role: 'standard' as const,
    currentVersion: 1,
  },
  definition: freestyle.definition,
  preset: {
    version: 1,
    formatVersion: 1,
    config: freestyle.preset,
    rankedEligible: false,
    current: true,
  },
};
