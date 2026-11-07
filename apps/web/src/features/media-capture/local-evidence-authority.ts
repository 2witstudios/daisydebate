import { requirePrivateEvidenceDirectory } from './local-evidence-storage';
import {
  initializeEvidencePrivacyLedger,
  localEvidencePrivacyLedger,
  evidencePrivacyDigest,
} from './local-evidence-privacy';
import {
  encodeEvidencePrivacyScope,
  type EvidencePrivacyScope,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { chmodSync, closeSync, openSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { idSchema, necessaryEvidencePolicy } from '@daisy/protocol';
import type {
  EvidenceIdentity,
  EvidenceCustodyReceipt,
  EvidenceRefusal,
} from '@daisy/protocol';

export type EvidenceAuthorityRecord = {
  readonly kind: 'current';
  readonly receipt: EvidenceCustodyReceipt;
  readonly payloadDigest: string;
  readonly privacyScopeDigest: string;
  readonly keyDigest: string | null;
};
export type EvidenceAuthority = {
  readonly identify: () =>
    | { readonly kind: 'identified'; readonly authorityId: string }
    | EvidenceRefusal;
  readonly reserve: (
    identity: EvidenceIdentity,
    payloadDigest: string,
    privacyScope: EvidencePrivacyScope,
  ) => EvidenceAuthorityRecord | EvidenceRefusal;
  readonly read: (
    identity: EvidenceIdentity,
  ) => EvidenceAuthorityRecord | EvidenceRefusal;
  readonly bindMaterial: (
    identity: EvidenceIdentity,
    work: (
      current: EvidenceAuthorityRecord,
      revalidate: () => EvidenceAuthorityRecord | EvidenceRefusal,
    ) => string | EvidenceRefusal,
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
  scope_digest: string | null;
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
      revoked INTEGER NOT NULL DEFAULT 0,scope_digest TEXT)`);
    initializeEvidencePrivacyLedger(db);
    db.query('INSERT INTO authority(id,last_now) VALUES(?,0)').run(
      input.authorityId,
    );
    db.run('PRAGMA user_version=2');
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
  const format = db
    .query<{ user_version: number }, []>('PRAGMA user_version')
    .get();
  if (format?.user_version !== 2) {
    db.close();
    throw createAppError('CONFLICT');
  }
  const privacy = localEvidencePrivacyLedger(db);
  const stored = db.query<{ id: string }, []>('SELECT id FROM authority').get();
  if (!stored || stored.id !== input.authorityId) {
    db.close();
    throw createAppError('CONFLICT');
  }
  const identify: EvidenceAuthority['identify'] = () => {
    try {
      const rows = db
        .query<{ id: string }, []>('SELECT id FROM authority')
        .all();
      return rows.length === 1 && rows[0]?.id === input.authorityId
        ? { kind: 'identified', authorityId: rows[0].id }
        : refused('uncertain');
    } catch {
      return refused('unavailable');
    }
  };
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
    if (!current.scope_digest) return refused('uncertain');
    const scope = privacy.scope(current.scope_digest);
    if ('kind' in scope) return scope;
    const privacyStatus = privacy.status(scope);
    if (privacyStatus) return privacyStatus;
    return {
      kind: 'current',
      payloadDigest: current.payload!,
      privacyScopeDigest: current.scope_digest,
      keyDigest: current.key_digest,
      receipt: {
        evidenceId: identity.evidenceId,
        bindingDigest: identity.bindingDigest,
        authorityId: input.authorityId,
        receivedAtMs: current.received,
        expiresAtMs: current.expires,
      },
    };
  };
  const guarded = <T>(work: () => T): T | EvidenceRefusal => {
    try {
      return db
        .transaction(() => {
          const current = identify();
          return current.kind === 'identified' ? work() : current;
        })
        .immediate();
    } catch {
      return refused('unavailable');
    }
  };
  const read: EvidenceAuthority['read'] = (identity) => {
    if (!evidenceIdentityValid(identity)) return refused('invalid');
    return guarded(() => checked(identity, row(identity.evidenceId), now()));
  };
  const reserve: EvidenceAuthority['reserve'] = (
    identity,
    payloadDigest,
    privacyScope,
  ) => {
    const encoded = encodeEvidencePrivacyScope(privacyScope);
    if (
      !evidenceIdentityValid(identity) ||
      !digestValid(payloadDigest) ||
      !encoded
    )
      return refused('invalid');
    const scopeDigest = evidencePrivacyDigest(encoded.document);
    return guarded(() => {
      const time = now();
      const existing = row(identity.evidenceId);
      if (existing) {
        const found = checked(identity, existing, time);
        if (found.kind !== 'current') return found;
        return found.payloadDigest !== payloadDigest ||
          found.privacyScopeDigest !== scopeDigest
          ? refused('conflict')
          : found;
      }
      const privacyStatus = privacy.status(encoded.scope);
      if (privacyStatus) return privacyStatus;
      const remembered = privacy.remember(
        encoded.scope,
        encoded.document,
        scopeDigest,
      );
      if ('kind' in remembered) return remembered;
      db.query(
        'INSERT INTO evidence(id,binding,payload,received,expires,scope_digest) VALUES(?,?,?,?,?,?)',
      ).run(
        identity.evidenceId,
        identity.bindingDigest,
        payloadDigest,
        time,
        time + necessaryEvidencePolicy.maxAgeMs,
        scopeDigest,
      );
      return checked(identity, row(identity.evidenceId), time);
    });
  };
  const bindMaterial: EvidenceAuthority['bindMaterial'] = (identity, work) => {
    if (!evidenceIdentityValid(identity)) return refused('invalid');
    return guarded(() => {
      const inspect = () => checked(identity, row(identity.evidenceId), now());
      const current = inspect();
      if (current.kind !== 'current') return current;
      let active = true;
      let result: string | EvidenceRefusal;
      try {
        result = work(current, () =>
          active ? inspect() : refused('uncertain'),
        );
      } finally {
        active = false;
      }
      if (typeof result !== 'string') return result;
      if (!digestValid(result)) return refused('invalid');
      // Material-lock waits and commits never renew original authority or expiry.
      const latest = inspect();
      if (latest.kind !== 'current') return latest;
      if (latest.keyDigest && latest.keyDigest !== result)
        return refused('uncertain');
      db.query('UPDATE evidence SET key_digest=? WHERE id=?').run(
        result,
        identity.evidenceId,
      );
      return { ...latest, keyDigest: result };
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
  return {
    identify,
    reserve,
    read,
    bindMaterial,
    revoke,
    preparePrivacy: (intent: unknown) => guarded(() => privacy.prepare(intent)),
    commitPrivacy: (intent: unknown) => guarded(() => privacy.commit(intent)),
    close: () => db.close(),
  };
}
