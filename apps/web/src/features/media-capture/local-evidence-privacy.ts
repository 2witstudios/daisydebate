import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
  encodeEvidencePrivacyScope,
  evidencePrivacyIntentSchema,
  type EvidencePrivacyScope,
  type EvidencePrivacyIntent,
  type EvidencePrivacyIntentRecord,
  type EvidenceRefusal,
} from '@daisy/protocol';
export const evidencePrivacyDigest = (document: string) =>
  createHash('sha3-256').update(document).digest('hex');
const refused = (reason: EvidenceRefusal['reason']): EvidenceRefusal => ({
  kind: 'refused',
  reason,
});
const scopeKey = (scope: EvidencePrivacyIntent['scope']) =>
  scope.kind === 'subject'
    ? `subject-privacy/${scope.actorId}`
    : `round-privacy/${scope.roundId}`;
type IntentRow = {
  sequence: number;
  scope_key: string;
  document: string;
  state: 'pending' | 'committed';
};
export function initializeEvidencePrivacyLedger(db: Database) {
  db.run(`CREATE TABLE evidence_scopes (digest TEXT PRIMARY KEY,document TEXT NOT NULL CHECK(length(document)<=8192));
    CREATE TABLE privacy_intents(sequence INTEGER PRIMARY KEY AUTOINCREMENT,scope_key TEXT NOT NULL UNIQUE,
      intent_id TEXT NOT NULL UNIQUE,document TEXT NOT NULL CHECK(length(document)<=1024),state TEXT NOT NULL CHECK(state IN ('pending','committed')));`);
}
/** Synchronous operations use the already-owned authority transaction; no independently acquired reverse lock. */
export function localEvidencePrivacyLedger(db: Database) {
  const record = (
    row: IntentRow,
  ): EvidencePrivacyIntentRecord | EvidenceRefusal => {
    const parsed = evidencePrivacyIntentSchema.safeParse(
      JSON.parse(row.document),
    );
    if (
      !parsed.success ||
      !Number.isSafeInteger(row.sequence) ||
      row.sequence < 1 ||
      !['pending', 'committed'].includes(row.state) ||
      scopeKey(parsed.data.scope) !== row.scope_key
    )
      return refused('uncertain');
    return { kind: row.state, intent: parsed.data, sequence: row.sequence };
  };
  const byKey = (key: string) =>
    db
      .query<IntentRow, [string]>(
        'SELECT sequence,scope_key,document,state FROM privacy_intents WHERE scope_key=?',
      )
      .get(key);
  return {
    remember(scope: EvidencePrivacyScope, document: string, digest: string) {
      const existing = db
        .query<{ document: string }, [string]>(
          'SELECT document FROM evidence_scopes WHERE digest=?',
        )
        .get(digest);
      if (existing && existing.document !== document)
        return refused('uncertain');
      if (!existing)
        db.query(
          'INSERT INTO evidence_scopes(digest,document) VALUES(?,?)',
        ).run(digest, document);
      return scope;
    },
    scope(digest: string): EvidencePrivacyScope | EvidenceRefusal {
      const found = db
        .query<{ document: string }, [string]>(
          'SELECT substr(document,1,8193) as document FROM evidence_scopes WHERE digest=?',
        )
        .get(digest);
      if (
        !found ||
        found.document.length > 8192 ||
        evidencePrivacyDigest(found.document) !== digest
      )
        return refused('uncertain');
      const parsed = encodeEvidencePrivacyScope(JSON.parse(found.document));
      return parsed?.scope ?? refused('uncertain');
    },
    status(scope: EvidencePrivacyScope): EvidenceRefusal | null {
      const keys = [
        `round-privacy/${scope.roundId}`,
        ...scope.subjectActorIds.map((id) => `subject-privacy/${id}`),
      ];
      const rows = db
        .query<{ state: string }, string[]>(
          `SELECT state FROM privacy_intents WHERE scope_key IN (${keys.map(() => '?').join(',')})`,
        )
        .all(...keys);
      if (rows.some((row) => row.state === 'committed'))
        return refused('revoked');
      return rows.length ? refused('uncertain') : null;
    },
    prepare(input: unknown): EvidencePrivacyIntentRecord | EvidenceRefusal {
      const parsed = evidencePrivacyIntentSchema.safeParse(input);
      if (!parsed.success) return refused('invalid');
      const key = scopeKey(parsed.data.scope);
      const collision = db
        .query<{ scope_key: string }, [string]>(
          'SELECT scope_key FROM privacy_intents WHERE intent_id=?',
        )
        .get(parsed.data.intentId);
      if (collision && collision.scope_key !== key) return refused('conflict');
      const existing = byKey(key);
      if (existing) {
        const known = record(existing);
        return known.kind === 'refused' ||
          JSON.stringify(known.intent.scope) !==
            JSON.stringify(parsed.data.scope)
          ? refused('conflict')
          : known;
      }
      db.query(
        "INSERT INTO privacy_intents(scope_key,intent_id,document,state) VALUES(?,?,?,'pending')",
      ).run(key, parsed.data.intentId, JSON.stringify(parsed.data));
      return record(byKey(key)!);
    },
    commit(input: unknown): EvidencePrivacyIntentRecord | EvidenceRefusal {
      const parsed = evidencePrivacyIntentSchema.safeParse(input);
      if (!parsed.success) return refused('invalid');
      const existing = byKey(scopeKey(parsed.data.scope));
      if (!existing) return refused('uncertain');
      if (existing.document !== JSON.stringify(parsed.data))
        return refused('conflict');
      db.query(
        "UPDATE privacy_intents SET state='committed' WHERE scope_key=?",
      ).run(existing.scope_key);
      return record(byKey(existing.scope_key)!);
    },
  };
}
