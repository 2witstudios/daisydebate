import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';

type Field = Pick<
  PrivacyFieldDeclaration,
  'column' | 'category' | 'visibility' | 'exportable'
>;
const id = (column: string): Field => ({
  column,
  category: 'identifier',
  exportable: false,
});
const none = (column: string): Field => ({
  column,
  category: 'none',
  exportable: false,
});
const personal = (column: string, exportable = false): Field => ({
  column,
  category: 'personal',
  visibility: 'private',
  exportable,
});
const secret = (column: string): Field => ({
  column,
  category: 'secret',
  exportable: false,
});

/** DEC-245: draw data lives with the Room or Round it serves. */
const retention = {
  status: 'pending' as const,
  decision: 'uofng5a07pluhrisfeqa0vx4',
};

const tables: readonly {
  readonly table: string;
  readonly purpose: string;
  readonly fields: readonly Field[];
}[] = [
  {
    table: 'resolution_bank_revisions',
    purpose: "Version Daisy's curated resolution bank (FMT-7)",
    fields: [none('revision'), none('note'), none('published_at')],
  },
  {
    table: 'resolution_bank_entries',
    purpose: 'Daisy-authored resolutions a draw may choose from',
    fields: [
      id('id'),
      none('text'),
      none('category'),
      none('difficulty'),
      none('locale'),
      none('provenance'),
      none('added_in_revision'),
      none('retired_in_revision'),
    ],
  },
  {
    table: 'room_resolution_draws',
    purpose: "Run a Room's pre-round resolution draw",
    fields: [
      id('id'),
      id('room_id'),
      none('source_kind'),
      none('draw_size'),
      none('manifest'),
      none('manifest_digest'),
      none('commitment'),
      secret('seed'),
      none('started_at'),
    ],
  },
  {
    table: 'room_resolution_draw_inputs',
    purpose:
      "Replay a draw: host-written lines and the seated players' recent resolutions",
    fields: [id('draw_id'), secret('inputs')],
  },
  {
    table: 'room_resolution_draw_items',
    purpose: 'The drawn resolutions the debaters strike from',
    fields: [
      id('draw_id'),
      none('position'),
      none('source_kind'),
      none('draw_size'),
      id('candidate_id'),
      id('bank_entry_id'),
      personal('text'),
      none('category'),
    ],
  },
  {
    table: 'room_resolution_strikes',
    purpose: 'Who struck which drawn resolution, and when',
    fields: [
      id('draw_id'),
      none('ordinal'),
      none('position'),
      none('draw_size'),
      none('side'),
      none('kind'),
      id('actor_id'),
      id('command_id'),
      none('struck_at'),
    ],
  },
  {
    table: 'round_draw_seeds',
    purpose: "Let operators replay a Round's draw; never delivered",
    fields: [id('round_id'), secret('seed')],
  },
  {
    table: 'round_resolution_draw_texts',
    purpose: "The drawn resolutions frozen with a Round's evidence",
    fields: [id('round_id'), none('position'), personal('text')],
  },
  {
    table: 'round_draw_private_inputs',
    purpose: "Let operators replay a Round's draw while its inputs exist",
    fields: [id('round_id'), secret('inputs')],
  },
];

/**
 * What erasure does to each kind of column: Room draw items keep their row
 * with the text scrubbed to a placeholder; private inputs and Round texts
 * are deleted. A seed is not the subject's data and is never erased, but a
 * secret cannot be declared retained, so it is declared deleted with the
 * row that owns it (its Room or Round).
 */
const erasureOf = (table: string, field: Field) =>
  field.category === 'none' || field.category === 'identifier'
    ? ('retain-nonpersonal' as const)
    : table === 'room_resolution_draw_items'
      ? ('scrub' as const)
      : ('delete' as const);

/** Every bank, draw and Round evidence column, declared (DEC-245). */
export const roomDrawPrivacyFields: readonly PrivacyFieldDeclaration[] =
  tables.flatMap(({ table, purpose, fields }) =>
    fields.map((field) => ({
      table,
      ...field,
      storage: 'postgres' as const,
      owner: 'FMT',
      purpose,
      lawfulBasis: retention,
      retention,
      erasure: erasureOf(table, field),
    })),
  );
