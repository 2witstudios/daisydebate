import type { PrivacyFieldDeclaration } from './contracts';

const columns = {
  users: {
    identifier: ['id'],
    personal: ['username', 'email', 'name', 'image', 'email_verified'],
    none: ['created_at', 'updated_at', 'version', 'deleted_at'],
  },
  privacy_jobs: {
    identifier: ['id', 'subject_ref'],
    personal: [],
    none: [
      'vendor',
      'status',
      'attempts',
      'created_at',
      'retry_at',
      'succeeded_at',
    ],
  },
} as const;
export const corePrivacyFields: readonly PrivacyFieldDeclaration[] =
  Object.entries(columns).flatMap(([table, groups]) =>
    Object.entries(groups).flatMap(([category, names]) =>
      names.map((column: string) => ({
        table,
        column,
        category: category as 'identifier' | 'personal' | 'none',
        ...(category === 'personal'
          ? {
              visibility:
                column === 'username'
                  ? ('public' as const)
                  : ('private' as const),
            }
          : {}),
        storage: 'postgres' as const,
        owner: 'PRIV',
        purpose:
          table === 'users'
            ? 'Account identity and subject rights'
            : 'Durable configured vendor erasure intent and acknowledgment',
        lawfulBasis: {
          status: 'pending' as const,
          decision: 'PRIV-3 / PRIV-H',
        },
        retention: { status: 'pending' as const, decision: 'PRIV-3 / PRIV-4' },
        erasure:
          category === 'personal'
            ? ('scrub' as const)
            : ('retain-nonpersonal' as const),
        exportable: table === 'users',
      })),
    ),
  );
