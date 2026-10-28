import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';

type Category = 'identifier' | 'personal' | 'none';
type Retention = PrivacyFieldDeclaration['retention'];

/** The pending proposals no capability's data carries legal authority from. */
const PENDING_BASIS = {
  status: 'pending',
  decision: 'jc0qcdvpkmqzrelpaesi3pah',
} as const;
const PENDING_RETENTION = {
  status: 'pending',
  decision: 'njiorsf64z4iqjm2dbfa3zuu',
} as const;

/**
 * One capability's declarations for tables it owns outright: personal
 * columns are private and deleted on erasure, identifiers and the rest
 * retained as non-personal, and every column exported to its subject.
 */
export function ownedTablePrivacyFields({
  owner,
  columns,
  purpose,
  retention = () => PENDING_RETENTION,
}: {
  readonly owner: string;
  readonly columns: Readonly<
    Record<string, Readonly<Record<Category, readonly string[]>>>
  >;
  readonly purpose: (table: string) => string;
  readonly retention?: (table: string) => Retention;
}): readonly PrivacyFieldDeclaration[] {
  return Object.entries(columns).flatMap(([table, groups]) =>
    (Object.entries(groups) as [Category, readonly string[]][]).flatMap(
      ([category, names]) =>
        names.map((column) => ({
          table,
          column,
          category,
          ...(category === 'personal'
            ? { visibility: 'private' as const }
            : {}),
          storage: 'postgres' as const,
          owner,
          purpose: purpose(table),
          lawfulBasis: PENDING_BASIS,
          retention: retention(table),
          erasure:
            category === 'personal'
              ? ('delete' as const)
              : ('retain-nonpersonal' as const),
          exportable: true,
        })),
    ),
  );
}

/** The columns each owned table is expected to have, for adoption checks. */
export const ownedTableExpectedColumns = (
  columns: Readonly<
    Record<string, Readonly<Record<Category, readonly string[]>>>
  >,
) =>
  Object.fromEntries(
    Object.entries(columns).map(([table, groups]) => [
      table,
      Object.values(groups).flat(),
    ]),
  );

/** Export values in plain JSON: ISO dates and numeric counters. */
export const exportRows = (rows: readonly Record<string, unknown>[]) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'bigint'
            ? Number(value)
            : value,
      ]),
    ),
  );
