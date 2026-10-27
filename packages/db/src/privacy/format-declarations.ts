import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';
import { privacyColumns, pendingPrivacyField } from './field-declarations';

/**
 * The format catalog (ADR 0058, ADR 0078): publisher rows and the private
 * custom formats a host publishes for a Room. Names are Daisy's or the
 * fixed "Custom format"; leagues and search terms are catalog copy. A
 * custom definition's segment labels can carry host-written text, which
 * ISSUE-712 classifies; until then the definition is declared as structure.
 */
const columns = {
  formats: {
    identifier: ['id', 'created_by_actor_id'],
    personal: [],
    none: [
      'name',
      'current_version',
      'catalog_role',
      'family',
      'leagues',
      'search_terms',
      'sort_order',
      'created_at',
      'updated_at',
    ],
  },
  format_revisions: {
    identifier: ['format_id'],
    personal: [],
    none: [
      'version',
      'definition',
      'rules_edition',
      'source_url',
      'created_at',
    ],
  },
  format_presets: {
    identifier: ['format_id'],
    personal: [],
    none: [
      'version',
      'format_version',
      'config',
      'ranked_eligible',
      'approved_at',
      'superseded_at',
    ],
  },
} as const;

export const formatPrivacyFields: readonly PrivacyFieldDeclaration[] =
  privacyColumns(columns).map(({ table, column, category }) =>
    pendingPrivacyField({
      table,
      column,
      category,
      owner: 'FORMAT',
      purpose: 'Debate format catalog and the rules a Room or Round pins',
      erasure: 'retain-nonpersonal',
      exportable: false,
    }),
  );
