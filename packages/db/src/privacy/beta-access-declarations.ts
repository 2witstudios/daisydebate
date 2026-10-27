import { sql } from 'drizzle-orm';
import type { PrivacyAdopter, PrivacyFieldDeclaration } from './contracts';

type Group = {
  readonly identifier: readonly string[];
  readonly personal: readonly string[];
  readonly none: readonly string[];
};

/**
 * ADR 0075 columns. The access row and mail intents are the subject's and
 * go with the account. The audit events and operator receipts are kept
 * against the tombstone as operational audit: after erasure they hold only
 * identifiers of an account with no personal data, like competitive history.
 */
const betaAccessColumns = {
  account_beta_access: {
    identifier: ['user_id'],
    personal: ['state', 'revision', 'requested_at', 'decided_at', 'provenance'],
    none: [],
  },
  account_access_events: {
    identifier: ['id', 'user_id', 'command_id', 'principal'],
    personal: [],
    none: ['from_state', 'to_state', 'revision', 'created_at'],
  },
  operator_command_receipts: {
    identifier: ['command_id', 'operator_ref', 'target_user_id'],
    personal: [],
    none: [
      'service_id',
      'action',
      'request_digest',
      'result',
      'admin_audit_head',
      'created_at',
    ],
  },
  mail_intents: {
    identifier: ['id', 'recipient_user_id', 'dedupe_key'],
    personal: [],
    none: [
      'purpose',
      'state',
      'attempts',
      'lease_token_digest',
      'lease_expires_at',
      'next_attempt_at',
      'window_start',
      'last_error_code',
      'created_at',
      'completed_at',
    ],
  },
} as const satisfies Record<string, Group>;

export const betaAccessPrivacyExpectedColumns = Object.fromEntries(
  Object.entries(betaAccessColumns).map(([table, groups]) => [
    table,
    Object.values(groups).flat(),
  ]),
);

const subjectOwned = new Set(['account_beta_access', 'mail_intents']);

const purposes: Record<keyof typeof betaAccessColumns, string> = {
  account_beta_access: 'Beta access gate and operator review',
  account_access_events: 'Operator audit of beta access changes',
  operator_command_receipts: 'Operator command idempotency and reconciliation',
  mail_intents: 'Durable delivery of owed beta mail',
};

/** Pending proposals carry no collection, legal-basis or retention authority. */
export const betaAccessPrivacyFields: readonly PrivacyFieldDeclaration[] =
  Object.entries(betaAccessColumns).flatMap(([table, groups]) =>
    Object.entries(groups).flatMap(([category, columns]) =>
      columns.map((column: string) => ({
        table,
        column,
        category: category as keyof Group,
        ...(category === 'personal' ? { visibility: 'private' as const } : {}),
        storage: 'postgres' as const,
        owner: 'BETA',
        purpose: purposes[table as keyof typeof betaAccessColumns],
        lawfulBasis: {
          status: 'pending' as const,
          decision: 'jc0qcdvpkmqzrelpaesi3pah',
        },
        retention: {
          status: 'pending' as const,
          decision: 'njiorsf64z4iqjm2dbfa3zuu',
        },
        erasure: subjectOwned.has(table)
          ? ('delete' as const)
          : ('retain-nonpersonal' as const),
        exportable: table === 'account_beta_access',
      })),
    ),
  );

/**
 * Erasure deletes the subject's beta state and any mail still owed to them
 * (ADR 0075): a tombstone has no beta state, and an approval email is never
 * sent to an erased account. Export returns the subject's own access row.
 */
export const betaAccessPrivacyAdopter: PrivacyAdopter = {
  id: 'beta-access',
  phase: 'after-scrub',
  fields: betaAccessPrivacyFields,
  erase: async (tx, subject) => {
    await tx.execute(
      sql`delete from mail_intents where recipient_user_id = ${subject.userId}`,
    );
    await tx.execute(
      sql`delete from account_beta_access where user_id = ${subject.userId}`,
    );
  },
  export: async (tx, subject) => {
    const rows = (await tx.execute(sql`select user_id, state, revision,
        to_char(requested_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as requested_at,
        to_char(decided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as decided_at,
        provenance
      from account_beta_access where user_id = ${subject.userId}`)) as unknown as Record<
      string,
      unknown
    >[];
    return { account_beta_access: rows };
  },
};
