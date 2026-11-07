import { evidenceEnvelopeSchema } from '@daisy/protocol';
import { requirePrivateEvidenceDirectory } from './local-evidence-storage';
import { chmodSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  necessaryEvidencePolicy,
  encodeEvidencePrivacyScope,
} from '@daisy/protocol';
import { evidencePrivacyDigest } from './local-evidence-privacy';
import type {
  EvidenceIdentity,
  EvidenceRefusal,
  NecessaryEvidenceCustody,
  SealedEvidence,
} from '@daisy/protocol';
import type { EvidenceAuthority } from './local-evidence-authority';

type Material = { key: Uint8Array; nonce: Uint8Array };
const digest = (bytes: Uint8Array) =>
  createHash('sha3-256').update(bytes).digest('hex');
const materialDigest = (material: Material) =>
  digest(Buffer.concat([material.key, material.nonce]));
const refused = (reason: EvidenceRefusal['reason']): EvidenceRefusal => ({
  kind: 'refused',
  reason,
});
const aad = (evidence: SealedEvidence['receipt']) =>
  Buffer.from(
    JSON.stringify([
      evidence.authorityId,
      evidence.evidenceId,
      evidence.bindingDigest,
      evidence.receivedAtMs,
      evidence.expiresAtMs,
    ]),
  );

/** LOCAL material cache. Required independent current authority gates EVERY operation. */
export function openLocalEvidenceCustody(input: {
  readonly path: string;
  readonly authority: EvidenceAuthority;
}): NecessaryEvidenceCustody & {
  readonly close: () => void;
  readonly sweep: (
    limit: number,
  ) => { readonly removed: number; readonly blocked: number } | EvidenceRefusal;
} {
  requirePrivateEvidenceDirectory(input.path);
  const db = new Database(input.path, { create: true, strict: true });
  db.run('PRAGMA busy_timeout=1000');
  chmodSync(input.path, 0o600);
  db.run('PRAGMA journal_mode=DELETE');
  db.run('PRAGMA synchronous=FULL');
  db.run('PRAGMA secure_delete=ON');
  db.run(
    'CREATE TABLE IF NOT EXISTS material(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,binding TEXT NOT NULL,expires INTEGER NOT NULL,key BLOB NOT NULL,nonce BLOB NOT NULL)',
  );
  db.run(
    'CREATE TABLE IF NOT EXISTS cleanup_cursor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),after_sequence INTEGER NOT NULL,through_sequence INTEGER)',
  );
  db.run('INSERT OR IGNORE INTO cleanup_cursor VALUES(1,0,NULL)');
  const material = (id: string) =>
    db
      .query<Material, [string]>('SELECT key,nonce FROM material WHERE id=?')
      .get(id);
  const seal: NecessaryEvidenceCustody['seal'] = async (
    identity,
    plaintext,
    privacyScope,
  ) => {
    const scope = encodeEvidencePrivacyScope(privacyScope);
    if (!scope) return refused('invalid');
    if (
      !plaintext.byteLength ||
      plaintext.byteLength > necessaryEvidencePolicy.maxPayloadBytes
    )
      return refused('invalid');
    try {
      const current = input.authority.reserve(
        identity,
        digest(plaintext),
        scope.scope,
      );
      if (current.kind !== 'current') return current;
      // All material creation takes authority -> material locks in that order.
      const bound = input.authority.bindMaterial(
        identity,
        (record, revalidate) =>
          db
            .transaction(() => {
              // The material lock may have waited across original expiry.
              const fresh = revalidate();
              if (fresh.kind !== 'current') return fresh;
              let found = material(identity.evidenceId);
              if (!found && !record.keyDigest) {
                db.query(
                  'INSERT INTO material(id,binding,expires,key,nonce) VALUES(?,?,?,?,?)',
                ).run(
                  identity.evidenceId,
                  identity.bindingDigest,
                  record.receipt.expiresAtMs,
                  randomBytes(32),
                  randomBytes(12),
                );
                found = material(identity.evidenceId);
              }
              if (
                !found ||
                found.key.byteLength !== 32 ||
                found.nonce.byteLength !== 12
              )
                return refused('uncertain');
              return materialDigest(found);
            })
            .immediate(),
      );
      if (bound.kind !== 'current') return bound;
      const held = material(identity.evidenceId);
      if (!held || materialDigest(held) !== bound.keyDigest)
        return refused('uncertain');
      const cipher = createCipheriv('aes-256-gcm', held.key, held.nonce);
      cipher.setAAD(aad(bound.receipt));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      // Revocation can occur between material/authority commits; recheck before releasing anything.
      const latest = input.authority.read(identity);
      if (latest.kind !== 'current') return latest;
      return {
        kind: 'sealed',
        receipt: bound.receipt,
        ciphertext,
        nonce: held.nonce,
        tag: cipher.getAuthTag(),
      };
    } catch {
      return refused('unavailable');
    }
  };
  const inspect: NecessaryEvidenceCustody['inspect'] = async (
    identity,
    privacyScope,
  ) => {
    const scope = encodeEvidencePrivacyScope(privacyScope);
    if (!scope) return refused('invalid');
    try {
      const current = input.authority.read(identity);
      if (current.kind !== 'current') return current;
      if (current.privacyScopeDigest !== evidencePrivacyDigest(scope.document))
        return refused('conflict');
      const held = material(identity.evidenceId);
      if (
        !held ||
        held.key.byteLength !== 32 ||
        held.nonce.byteLength !== 12 ||
        materialDigest(held) !== current.keyDigest
      )
        return refused('uncertain');
      const latest = input.authority.read(identity);
      if (latest.kind !== 'current') return latest;
      return {
        kind: 'available',
        receipt: latest.receipt,
        payloadDigest: latest.payloadDigest,
      };
    } catch {
      return refused('unavailable');
    }
  };
  const open: NecessaryEvidenceCustody['open'] = async (evidence) => {
    if (!evidenceEnvelopeSchema.safeParse(evidence).success)
      return refused('invalid');
    try {
      const current = input.authority.read(evidence.receipt);
      if (current.kind !== 'current') return current;
      if (!aad(current.receipt).equals(aad(evidence.receipt)))
        return refused('conflict');
      const held = material(evidence.receipt.evidenceId);
      if (!held || materialDigest(held) !== current.keyDigest)
        return refused('uncertain');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        held.key,
        evidence.nonce,
      );
      decipher.setAAD(aad(current.receipt));
      decipher.setAuthTag(evidence.tag);
      const plaintext = Buffer.concat([
        decipher.update(evidence.ciphertext),
        decipher.final(),
      ]);
      if (digest(plaintext) !== current.payloadDigest) {
        plaintext.fill(0);
        return refused('conflict');
      }
      const latest = input.authority.read(evidence.receipt);
      if (latest.kind !== 'current') {
        plaintext.fill(0);
        return latest;
      }
      return { kind: 'opened', plaintext };
    } catch {
      return refused('unavailable');
    }
  };
  const revoke: NecessaryEvidenceCustody['revoke'] = async (
    identity: EvidenceIdentity,
  ) => {
    try {
      // Commit the authoritative fence FIRST. Retry finishes material cleanup after a crash.
      const result = input.authority.revoke(identity);
      if (result.kind !== 'revoked') return result;
      db.query('DELETE FROM material WHERE id=?').run(identity.evidenceId);
      return result;
    } catch {
      return refused('unavailable');
    }
  };
  const sweep = (limit: number) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
      return refused('invalid');
    try {
      const candidates = db
        .transaction(() => {
          let cursor = db
            .query<
              { after_sequence: number; through_sequence: number | null },
              []
            >(
              'SELECT after_sequence,through_sequence FROM cleanup_cursor WHERE singleton=1',
            )
            .get()!;
          if (cursor.through_sequence === null) {
            const { upper } = db
              .query<{ upper: number }, []>(
                'SELECT coalesce(max(sequence),0) as upper FROM material',
              )
              .get()!;
            cursor = { after_sequence: 0, through_sequence: upper };
          }
          const page = db
            .query<
              { sequence: number; id: string; binding: string },
              [number, number, number]
            >(
              'SELECT sequence,id,binding FROM material WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT ?',
            )
            .all(cursor.after_sequence, cursor.through_sequence!, limit);
          const after = page.at(-1)?.sequence ?? cursor.through_sequence!;
          if (after >= cursor.through_sequence!)
            db.run(
              'UPDATE cleanup_cursor SET after_sequence=0,through_sequence=NULL WHERE singleton=1',
            );
          else
            db.query(
              'UPDATE cleanup_cursor SET after_sequence=?,through_sequence=? WHERE singleton=1',
            ).run(after, cursor.through_sequence);
          return page;
        })
        .immediate();
      let removed = 0,
        blocked = 0;
      for (const candidate of candidates) {
        const state = input.authority.read({
          evidenceId: candidate.id,
          bindingDigest: candidate.binding,
        });
        if (
          state.kind === 'refused' &&
          (state.reason === 'revoked' || state.reason === 'expired')
        ) {
          removed += db
            .query('DELETE FROM material WHERE id=?')
            .run(candidate.id).changes;
        } else if (state.kind === 'refused') blocked++;
      }
      return { removed, blocked };
    } catch {
      return refused('unavailable');
    }
  };
  return { seal, open, inspect, revoke, sweep, close: () => db.close() };
}
