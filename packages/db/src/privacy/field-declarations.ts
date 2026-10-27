import type { PrivacyFieldDeclaration } from './contracts';

/** Flatten explicit producer column groups without deriving policy from a schema. */
export const privacyColumns = (
  columns: Readonly<
    Record<
      string,
      Readonly<Record<'identifier' | 'personal' | 'none', readonly string[]>>
    >
  >,
) =>
  Object.entries(columns).flatMap(([table, groups]) =>
    Object.entries(groups).flatMap(([category, names]) =>
      names.map((column) => ({
        table,
        column,
        category: category as 'identifier' | 'personal' | 'none',
      })),
    ),
  );

/** Shared unresolved policy owners; a declaration never approves processing. */
export const pendingPrivacyField = (
  field: Omit<PrivacyFieldDeclaration, 'storage' | 'lawfulBasis' | 'retention'>,
): PrivacyFieldDeclaration => ({
  ...field,
  storage: 'postgres',
  lawfulBasis: { status: 'pending', decision: 'jc0qcdvpkmqzrelpaesi3pah' },
  retention: { status: 'pending', decision: 'njiorsf64z4iqjm2dbfa3zuu' },
});
