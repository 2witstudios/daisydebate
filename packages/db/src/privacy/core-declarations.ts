import type { PrivacyFieldDeclaration } from './contracts';
import { privacyColumns, pendingPrivacyField } from './field-declarations';

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
  privacyColumns(columns).map(({ table, column, category }) =>
    pendingPrivacyField({
      table,
      column,
      category,
      ...(category === 'personal'
        ? {
            visibility:
              column === 'username'
                ? ('public' as const)
                : ('private' as const),
          }
        : {}),
      owner: 'PRIV',
      purpose:
        table === 'users'
          ? 'Account identity and subject rights'
          : 'Durable configured vendor erasure intent and acknowledgment',
      erasure: category === 'personal' ? 'scrub' : 'retain-nonpersonal',
      exportable: table === 'users',
    }),
  );
