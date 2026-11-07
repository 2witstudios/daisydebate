import type { Database } from '@daisy/db';
import { isAppError } from '@daisy/errors';
import { z } from 'zod';
import {
  idSchema,
  type EvidenceRefusal,
  type NecessaryEvidenceCustody,
  type NecessaryEvidenceRestoreReply,
} from '@daisy/protocol';
import {
  createEvidenceAuthentication,
  prepareEvidenceBody,
  evidenceBodyDigest,
  sameSealedEvidence,
  type PreparedEvidenceBody,
} from './necessary-evidence-authentication';
type Store = Pick<
  ReturnType<Database['createMediaCaptureOperations']>,
  'loadCaptureEvidencePayload' | 'readCaptureEvidencePayload'
>;
const refused = (reason: EvidenceRefusal['reason']): EvidenceRefusal => ({
  kind: 'refused',
  reason,
});
/** Private stored original evidence. A restored body is not STT dispatch or fresh play permission. */
export function createStoredEvidenceRestore({
  store,
  custody,
}: {
  readonly store: Store;
  readonly custody: NecessaryEvidenceCustody;
}) {
  const { currentCustody } = createEvidenceAuthentication(custody);
  return async (raw: unknown): Promise<NecessaryEvidenceRestoreReply> => {
    const parsed = z
      .strictObject({ roundId: idSchema, evidenceId: idSchema })
      .safeParse(raw);
    if (!parsed.success) return refused('invalid');
    const pending = {
      kind: 'pending' as const,
      evidenceId: parsed.data.evidenceId,
    };
    try {
      const stored = await store.loadCaptureEvidencePayload(parsed.data);
      if (stored.kind === 'missing') return refused('uncertain');
      if (stored.kind === 'pending') return pending;
      const opened = await custody.open(stored.sealed);
      if (opened.kind === 'refused') return opened;
      let encoded: PreparedEvidenceBody | null;
      try {
        encoded = prepareEvidenceBody(
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(opened.plaintext),
          ),
        );
        if (
          !encoded ||
          evidenceBodyDigest(opened.plaintext) !== encoded.digest ||
          encoded.body.roundId !== parsed.data.roundId ||
          encoded.body.evidenceId !== parsed.data.evidenceId
        )
          return refused('invalid');
      } catch {
        return refused('invalid');
      } finally {
        opened.plaintext.fill(0);
      }
      const denial = await currentCustody(
        encoded,
        stored.sealed,
        stored.privacyScope,
      );
      if (denial) return denial;
      // A new transaction obtains accounts before Round. Never reacquire users after an owned Round lock.
      const latest = await store.readCaptureEvidencePayload({
        body: encoded.body,
      });
      if (
        latest.kind !== 'received' ||
        latest.bodyDigest !== encoded.digest ||
        latest.payloadAcceptedAt !== stored.payloadAcceptedAt ||
        !sameSealedEvidence(latest.sealed, stored.sealed)
      )
        return refused('conflict');
      return {
        kind: 'restored',
        body: encoded.body,
        speaker: latest.originalSpeaker,
        receipt: {
          kind: 'received',
          evidenceId: latest.evidenceId,
          bindingDigest: latest.bindingDigest,
          payloadAcceptedAt: latest.payloadAcceptedAt,
          receipt: latest.sealed.receipt,
        },
      };
    } catch (error) {
      if (isAppError(error)) {
        if (error.code === 'VALIDATION') return refused('invalid');
        if (error.code === 'AUTHORIZATION') return refused('uncertain');
        if (error.code === 'CONFLICT') return refused('conflict');
      }
      return pending;
    }
  };
}
