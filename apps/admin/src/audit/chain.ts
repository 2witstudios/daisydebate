import { sha3 } from '../auth/secrets';
import type { auditKinds } from '../db/schema';

/**
 * The admin audit chain (ADR 0076): each row's
 * `hash = SHA3-256(prev_hash ‖ canonical JSON of the row without hash)`,
 * from the genesis `SHA3-256("daisy-admin-audit-v1")`. It proves the rows
 * read back are the rows written, in order, from a known start; a rewrite of
 * the whole chain needs an outside anchor to detect (participant receipts,
 * BETA-5). The badge claims exactly that and no more.
 */
export const GENESIS_HASH = sha3('daisy-admin-audit-v1');

export type AuditKind = (typeof auditKinds)[number];

/** Closed detail vocabulary: never free text, never a credential. */
export const auditDetails = [
  'initial',
  'additional',
  'replace',
  'rate_limited',
  'challenge_invalid',
  'enrollment_invalid',
  'credential_unknown',
  'credential_duplicate',
  'verification_failed',
  'counter_regressed',
  'operator_disabled',
  'session_expired',
  'session_idle',
  'signed_out',
  'rotated',
  'replaced',
  'role',
  'approval_missing',
] as const;
export type AuditDetail = (typeof auditDetails)[number];

export type AuditEvent = {
  readonly id: string;
  readonly kind: AuditKind;
  readonly operatorId: string | null;
  readonly commandId: string | null;
  readonly targetUserId: string | null;
  readonly outcome: string | null;
  readonly detail: AuditDetail | null;
  readonly at: string;
};

export type AuditRow = AuditEvent & {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
};

/** Where verification starts: genesis, or the checkpoint of a prune. */
export type ChainAnchor = { readonly seq: number; readonly hash: string };
export const genesisAnchor: ChainAnchor = { seq: 0, hash: GENESIS_HASH };

/** Sorted keys, every field present (null when absent), UTC ISO time. */
export const canonicalAuditJson = (row: Omit<AuditRow, 'hash'>): string =>
  JSON.stringify({
    at: new Date(row.at).toISOString(),
    commandId: row.commandId,
    detail: row.detail,
    id: row.id,
    kind: row.kind,
    operatorId: row.operatorId,
    outcome: row.outcome,
    prevHash: row.prevHash,
    seq: row.seq,
    targetUserId: row.targetUserId,
  });

export const auditHash = (row: Omit<AuditRow, 'hash'>): string =>
  sha3(`${row.prevHash}${canonicalAuditJson(row)}`);

/** The row that follows `head` (the current chain head) for `event`. */
export function chainNext(head: ChainAnchor, event: AuditEvent): AuditRow {
  const row = { ...event, seq: head.seq + 1, prevHash: head.hash };
  return { ...row, hash: auditHash(row) };
}

export type ChainVerdict =
  | { readonly status: 'empty' }
  | {
      readonly status: 'consistent';
      readonly first: number;
      readonly last: number;
    }
  | {
      readonly status: 'broken';
      readonly seq: number;
      readonly reason: 'gap' | 'link' | 'hash';
    }
  | { readonly status: 'truncated'; readonly expectedSeq: number };

const anchorProblem = (
  rows: readonly AuditRow[],
  known: readonly ChainAnchor[],
): ChainVerdict | null => {
  const last = rows.at(-1)?.seq ?? 0;
  for (const anchor of known) {
    if (anchor.seq > last)
      return { status: 'truncated', expectedSeq: anchor.seq };
    const row = rows.find(({ seq }) => seq === anchor.seq);
    if (row !== undefined && row.hash !== anchor.hash)
      return { status: 'broken', seq: anchor.seq, reason: 'hash' };
  }
  return null;
};

/**
 * Walks `rows` (ascending seq) from `start`: every seq follows the last,
 * links to its predecessor's hash and hashes to its own. `known` heads
 * (anchors recorded elsewhere) must still be present, which is how a
 * truncated tail is detected.
 */
export function verifyAuditChain(
  rows: readonly AuditRow[],
  start: ChainAnchor,
  known: readonly ChainAnchor[] = [],
): ChainVerdict {
  let previous = start;
  for (const row of rows) {
    if (row.seq !== previous.seq + 1)
      return { status: 'broken', seq: row.seq, reason: 'gap' };
    if (row.prevHash !== previous.hash)
      return { status: 'broken', seq: row.seq, reason: 'link' };
    if (auditHash(row) !== row.hash)
      return { status: 'broken', seq: row.seq, reason: 'hash' };
    previous = row;
  }
  const anchored = anchorProblem(rows, known);
  if (anchored) return anchored;
  const [first] = rows;
  return first === undefined
    ? { status: 'empty' }
    : { status: 'consistent', first: first.seq, last: previous.seq };
}
