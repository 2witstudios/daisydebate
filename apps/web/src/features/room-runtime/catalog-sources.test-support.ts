import type { FormatSelectionFacts } from '@daisy/protocol';
import {
  foundationSettings,
  foundationDefinition,
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';

/** Catalog sources as the store lists them: role-bearing formats at their canonical presets. */
export const catalog = [
  {
    id: 'value',
    name: 'Value',
    version: 1,
    role: 'standard' as const,
    family: null,
    leagues: [],
    searchTerms: 'value daisy',
    sortOrder: 2,
    rulesEdition: null,
    sourceUrl: null,
    definition: oneOnOneDefinition,
    preset: {
      formatId: 'value',
      version: 1,
      formatVersion: 1,
      config: oneOnOneSettings,
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
      formatId: 'proof-template',
      version: 2,
      formatVersion: 1,
      config: foundationSettings,
    },
  },
];

/** The selection facts the store reports for the Value standard's current tuple. */
export const valueFacts: FormatSelectionFacts = {
  format: {
    id: 'value',
    name: 'Value',
    leagues: [],
    catalogOwned: true,
    role: 'standard' as const,
    currentVersion: 1,
  },
  definition: oneOnOneDefinition,
  preset: {
    version: 1,
    formatVersion: 1,
    config: oneOnOneSettings,
    rankedEligible: false,
    current: true,
  },
};
