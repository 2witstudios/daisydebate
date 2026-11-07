import { requirePrivateEvidenceDirectory } from './local-evidence-storage';
import { chmodSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { necessaryEvidencePolicy } from '@daisy/protocol';
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
    'CREATE TABLE IF NOT EXISTS material(id TEXT PRIMARY KEY,binding TEXT NOT NULL,expires INTEGER NOT NULL,key BLOB NOT NULL,nonce BLOB NOT NULL)',
  );
  const material = (id: string) =>
    db
      .query<Material, [string]>('SELECT key,nonce FROM material WHERE id=?')
      .get(id);
  const seal: NecessaryEvidenceCustody['seal'] = async (
    identity,
    plaintext,
  ) => {
    if (
      !plaintext.byteLength ||
      plaintext.byteLength > necessaryEvidencePolicy.maxPayloadBytes
    )
      return refused('invalid');
    try {
      const current = input.authority.reserve(identity, digest(plaintext));
      if (current.kind !== 'current') return current;
      const held = db
        .transaction(() => {
          let found = material(identity.evidenceId);
          // A previously bound key may NEVER be replaced, even after a lost acknowledgement or restore.
          if (!found && !current.keyDigest) {
            db.query(
              'INSERT INTO material(id,binding,expires,key,nonce) VALUES(?,?,?,?,?)',
            ).run(
              identity.evidenceId,
              identity.bindingDigest,
              current.receipt.expiresAtMs,
              randomBytes(32),
              randomBytes(12),
            );
            found = material(identity.evidenceId);
          }
          return found;
        })
        .immediate();
      if (!held) return refused('uncertain');
      const bound = input.authority.bindKey(identity, digest(held.key));
      if (bound.kind !== 'current') return bound;
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
  const open: NecessaryEvidenceCustody['open'] = async (evidence) => {
    try {
      const current = input.authority.read(evidence.receipt);
      if (current.kind !== 'current') return current;
      if (!aad(current.receipt).equals(aad(evidence.receipt)))
        return refused('conflict');
      const held = material(evidence.receipt.evidenceId);
      if (!held || digest(held.key) !== current.keyDigest)
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
        .query<{ id: string; binding: string }, [number]>(
          'SELECT id,binding FROM material ORDER BY expires,id LIMIT ?',
        )
        .all(limit);
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
          db.query('DELETE FROM material WHERE id=?').run(candidate.id);
          removed++;
        } else if (state.kind === 'refused') blocked++;
      }
      return { removed, blocked };
    } catch {
      return refused('unavailable');
    }
  };
  return { seal, open, revoke, sweep, close: () => db.close() };
}
