import { requirePrivateEvidenceDirectory } from './local-evidence-storage';
import { createAppError } from '@daisy/errors';
import { chmodSync, closeSync, openSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { idSchema, necessaryEvidencePolicy } from '@daisy/protocol';
import type {
  EvidenceIdentity,
  EvidenceReceipt,
  EvidenceRefusal,
} from '@daisy/protocol';

export type EvidenceAuthorityRecord = {
  readonly kind: 'current';
  readonly receipt: EvidenceReceipt;
  readonly payloadDigest: string;
  readonly keyDigest: string | null;
};
export type EvidenceAuthority = {
  readonly reserve: (
    identity: EvidenceIdentity,
    payloadDigest: string,
  ) => EvidenceAuthorityRecord | EvidenceRefusal;
  readonly read: (
    identity: EvidenceIdentity,
  ) => EvidenceAuthorityRecord | EvidenceRefusal;
  readonly bindKey: (
    identity: EvidenceIdentity,
    digest: string,
  ) => EvidenceAuthorityRecord | EvidenceRefusal;
  readonly revoke: (
    identity: EvidenceIdentity,
  ) => { readonly kind: 'revoked' } | EvidenceRefusal;
};
type Row = {
  id: string;
  binding: string;
  payload: string | null;
  key_digest: string | null;
  received: number;
  expires: number;
  revoked: number;
};
const refused = (reason: EvidenceRefusal['reason']): EvidenceRefusal => ({
  kind: 'refused',
  reason,
});
export const evidenceIdentityValid = (identity: EvidenceIdentity) =>
  idSchema.safeParse(identity.evidenceId).success &&
  /^[a-f0-9]{64}$/.test(identity.bindingDigest);
const digestValid = (digest: string) => /^[a-f0-9]{64}$/.test(digest);

/** Explicit isolated provisioning. Restart NEVER creates missing authority or resets its identity. */
export function initializeLocalEvidenceAuthority(input: {
  readonly path: string;
  readonly authorityId: string;
}) {
  if (!idSchema.safeParse(input.authorityId).success)
    throw createAppError('VALIDATION');
  requirePrivateEvidenceDirectory(input.path);
  closeSync(openSync(input.path, 'wx', 0o600));
  requirePrivateEvidenceDirectory(input.path);
  const db = new Database(input.path, {
    readwrite: true,
    create: false,
    strict: true,
  });
  try {
    db.run('PRAGMA synchronous=FULL');
    db.run(`CREATE TABLE authority (id TEXT PRIMARY KEY, last_now INTEGER NOT NULL);
      CREATE TABLE evidence (id TEXT PRIMARY KEY, binding TEXT NOT NULL,
      payload TEXT, key_digest TEXT, received INTEGER NOT NULL, expires INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0)`);
    db.query('INSERT INTO authority(id,last_now) VALUES(?,0)').run(
      input.authorityId,
    );
  } finally {
    db.close();
  }
}

/** LOCAL qualification only. This is the independent CURRENT authority, never a restored key cache. */
export function openLocalEvidenceAuthority(input: {
  readonly path: string;
  readonly authorityId: string;
  readonly nowMs: () => number;
}) {
  if (!idSchema.safeParse(input.authorityId).success)
    throw createAppError('VALIDATION');
  requirePrivateEvidenceDirectory(input.path);
  const db = new Database(input.path, {
    readwrite: true,
    create: false,
    strict: true,
  });
  db.run('PRAGMA busy_timeout=1000');
  chmodSync(input.path, 0o600);
  db.run('PRAGMA journal_mode=DELETE');
  db.run('PRAGMA synchronous=FULL');
  const stored = db.query<{ id: string }, []>('SELECT id FROM authority').get();
  if (!stored || stored.id !== input.authorityId) {
    db.close();
    throw createAppError('CONFLICT');
  }
  const row = (id: string) =>
    db.query<Row, [string]>('SELECT * FROM evidence WHERE id=?').get(id);
  const now = () => {
    const sampled = input.nowMs();
    if (!Number.isSafeInteger(sampled) || sampled < 0)
      throw createAppError('INFRASTRUCTURE');
    db.query('UPDATE authority SET last_now=max(last_now,?)').run(sampled);
    return db
      .query<{ last_now: number }, []>('SELECT last_now FROM authority')
      .get()!.last_now;
  };
  const checked = (
    identity: EvidenceIdentity,
    current: Row | null,
    time: number,
  ): EvidenceAuthorityRecord | EvidenceRefusal => {
    if (!current) return refused('uncertain');
    if (current.revoked) return refused('revoked');
    if (current.expires <= time) return refused('expired');
    if (current.binding !== identity.bindingDigest) return refused('conflict');
    return {
      kind: 'current',
      payloadDigest: current.payload!,
      keyDigest: current.key_digest,
      receipt: {
        ...identity,
        authorityId: input.authorityId,
        receivedAtMs: current.received,
        expiresAtMs: current.expires,
      },
    };
  };
  const guarded = <T>(work: () => T): T | EvidenceRefusal => {
    try {
      return db.transaction(work).immediate();
    } catch {
      return refused('unavailable');
    }
  };
  const read: EvidenceAuthority['read'] = (identity) => {
    if (!evidenceIdentityValid(identity)) return refused('invalid');
    return guarded(() => checked(identity, row(identity.evidenceId), now()));
  };
  const reserve: EvidenceAuthority['reserve'] = (identity, payloadDigest) => {
    if (!evidenceIdentityValid(identity) || !digestValid(payloadDigest))
      return refused('invalid');
    return guarded(() => {
      const time = now();
      db.query(
        'INSERT OR IGNORE INTO evidence(id,binding,payload,received,expires) VALUES(?,?,?,?,?)',
      ).run(
        identity.evidenceId,
        identity.bindingDigest,
        payloadDigest,
        time,
        time + necessaryEvidencePolicy.maxAgeMs,
      );
      const found = checked(identity, row(identity.evidenceId), time);
      return found.kind === 'current' && found.payloadDigest !== payloadDigest
        ? refused('conflict')
        : found;
    });
  };
  const bindKey: EvidenceAuthority['bindKey'] = (identity, digest) => {
    if (!evidenceIdentityValid(identity) || !digestValid(digest))
      return refused('invalid');
    return guarded(() => {
      const found = checked(identity, row(identity.evidenceId), now());
      if (found.kind !== 'current') return found;
      if (found.keyDigest && found.keyDigest !== digest)
        return refused('uncertain');
      db.query('UPDATE evidence SET key_digest=? WHERE id=?').run(
        digest,
        identity.evidenceId,
      );
      return { ...found, keyDigest: digest };
    });
  };
  const revoke: EvidenceAuthority['revoke'] = (identity) => {
    if (!evidenceIdentityValid(identity)) return refused('invalid');
    return guarded(() => {
      const time = now();
      // Unknown IDs are tombstoned too: a delayed acquisition cannot resurrect them.
      db.query(
        'INSERT OR IGNORE INTO evidence(id,binding,received,expires,revoked) VALUES(?,?,?,?,1)',
      ).run(identity.evidenceId, identity.bindingDigest, time, time);
      const existing = row(identity.evidenceId)!;
      if (existing.binding !== identity.bindingDigest)
        return refused('conflict');
      db.query('UPDATE evidence SET revoked=1 WHERE id=?').run(
        identity.evidenceId,
      );
      return { kind: 'revoked' as const };
    });
  };
  return { reserve, read, bindKey, revoke, close: () => db.close() };
}
