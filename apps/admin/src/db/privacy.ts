import type { PrivacyFieldDeclaration } from '@daisy/protocol/privacy';

/**
 * Every admin database column (ADR 0036, ADR 0077; BETA plan §8). The
 * owner-approved plan fixes the lawful basis (legitimate interest: operating
 * the service) and every retention but the audit log's two years, which
 * stays pending the owner's decision.
 */
const plan = 'z581n50qszdmyguopeeb8ed5';
type Category = PrivacyFieldDeclaration['category'];
type Table = {
  readonly purpose: string;
  readonly retention: string | null;
  readonly erasure: PrivacyFieldDeclaration['erasure'];
  readonly columns: Readonly<Partial<Record<Category, readonly string[]>>>;
};

const auditRetention = null;
const tables: Readonly<Record<string, Table>> = {
  operators: {
    purpose: 'Operator identity and role',
    retention: 'while the operator exists',
    erasure: 'delete',
    columns: {
      identifier: ['id'],
      personal: ['display_name'],
      none: ['role', 'created_at', 'disabled_at', 'revision'],
    },
  },
  operator_credentials: {
    purpose: 'Passkey authentication',
    retention: 'until revoked plus 90 days',
    erasure: 'delete',
    columns: {
      identifier: ['id', 'operator_id', 'credential_id', 'public_key'],
      none: [
        'sign_count',
        'transports',
        'backed_up',
        'created_at',
        'revoked_at',
      ],
    },
  },
  operator_enrollments: {
    purpose: 'One-time passkey enrollment',
    retention: 'expired rows swept after 7 days',
    erasure: 'delete',
    columns: {
      identifier: ['id', 'operator_id'],
      secret: ['token_hash'],
      none: ['mode', 'created_at', 'expires_at', 'consumed_at', 'revoked_at'],
    },
  },
  operator_challenges: {
    purpose: 'Single-use WebAuthn challenges',
    retention: 'expired rows swept after 7 days',
    erasure: 'delete',
    columns: {
      identifier: ['id', 'enrollment_id'],
      secret: ['challenge_hash'],
      none: ['purpose', 'created_at', 'expires_at', 'consumed_at'],
    },
  },
  operator_sessions: {
    purpose: 'Operator sessions',
    retention: 'expired rows swept after 7 days',
    erasure: 'delete',
    columns: {
      identifier: ['id', 'operator_id'],
      secret: ['token_hash'],
      none: ['created_at', 'last_seen_at', 'expires_at', 'revoked_at'],
    },
  },
  auth_attempts: {
    purpose:
      'Rate limiting failed authentication (keyed client digest, no raw IP)',
    retention: '1 day',
    erasure: 'delete',
    columns: { none: ['bucket', 'count', 'window_start'] },
  },
  audit_events: {
    purpose: 'Tamper-evident operator audit',
    retention: auditRetention,
    erasure: 'retain-nonpersonal',
    columns: {
      identifier: ['id', 'operator_id', 'command_id', 'target_user_id'],
      none: ['seq', 'kind', 'outcome', 'detail', 'at', 'prev_hash', 'hash'],
    },
  },
  pending_commands: {
    purpose: 'Retry identity of an operator command until its outcome is known',
    retention: '30 days after resolution',
    erasure: 'delete',
    columns: {
      identifier: ['command_id', 'operator_id', 'target_user_id'],
      none: [
        'desired_state',
        'expected_revision',
        'created_at',
        'last_signed_at',
        'resolved_at',
      ],
    },
  },
  chain_checkpoints: {
    purpose: 'Where the retained audit chain starts after pruning',
    retention: auditRetention,
    erasure: 'retain-nonpersonal',
    columns: { none: ['seq', 'hash', 'at'] },
  },
};

export const adminPrivacyFields: readonly PrivacyFieldDeclaration[] =
  Object.entries(tables).flatMap(([table, spec]) =>
    Object.entries(spec.columns).flatMap(([category, columns]) =>
      (columns ?? []).map((column): PrivacyFieldDeclaration => ({
        table,
        column,
        category: category as Category,
        ...(category === 'personal' ? { visibility: 'private' as const } : {}),
        storage: 'postgres',
        owner: 'ADMIN',
        purpose: spec.purpose,
        lawfulBasis: {
          status: 'approved',
          decision: plan,
          rule: 'legitimate interest',
        },
        retention:
          spec.retention === null
            ? { status: 'pending', decision: plan }
            : { status: 'approved', decision: plan, rule: spec.retention },
        erasure: spec.erasure,
        exportable: false,
      })),
    ),
  );
