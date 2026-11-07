import type { Database } from '@daisy/db';
import { isAppError } from '@daisy/errors';
import {
  evidenceEnvelopeSchema,
  idSchema,
  type EvidenceRefusal,
  type NecessaryEvidenceCustody,
  type NecessaryEvidenceIngressReply,
} from '@daisy/protocol';
import {
  createEvidenceAuthentication,
  prepareEvidenceBody,
  sameSealedEvidence,
  type PreparedEvidenceBody,
} from './necessary-evidence-authentication';
import { createStoredEvidenceRestore } from './necessary-evidence-restore';
type Store = Pick<
  ReturnType<Database['createMediaCaptureOperations']>,
  | 'readCaptureEvidencePayload'
  | 'loadCaptureEvidencePayload'
  | 'reserveCaptureEvidence'
  | 'claimCaptureEvidenceReconciliation'
  | 'adoptCaptureEvidence'
>;
const refused = (reason: EvidenceRefusal['reason']): EvidenceRefusal => ({
  kind: 'refused',
  reason,
});
/** Private local capability. A returned historical payload receipt is never fresh capture/publication/hearing permission. */
export function createNecessaryEvidenceIngress({
  store,
  custody,
}: {
  readonly store: Store;
  readonly custody: NecessaryEvidenceCustody;
}) {
  const { authenticated } = createEvidenceAuthentication(custody);
  const confirm = async (encoded: PreparedEvidenceBody) => {
    const stored = await store.readCaptureEvidencePayload({
      body: encoded.body,
    });
    if (stored.kind !== 'received') return stored;
    const denial = await authenticated(
      encoded,
      stored.sealed,
      stored.privacyScope,
    );
    if (denial) return denial;
    const latest = await store.readCaptureEvidencePayload({
      body: encoded.body,
    });
    if (latest.kind !== 'received') return refused('uncertain');
    if (
      latest.bodyDigest !== encoded.digest ||
      latest.payloadAcceptedAt !== stored.payloadAcceptedAt ||
      !sameSealedEvidence(latest.sealed, stored.sealed)
    )
      return refused('conflict');
    return {
      kind: 'received' as const,
      evidenceId: latest.evidenceId,
      bindingDigest: latest.bindingDigest,
      payloadAcceptedAt: latest.payloadAcceptedAt,
      receipt: latest.sealed.receipt,
    };
  };
  const receivePrepared = async (
    encoded: PreparedEvidenceBody,
    recoveryWorker?: string,
  ): Promise<NecessaryEvidenceIngressReply> => {
    const pending = {
      kind: 'pending' as const,
      evidenceId: encoded.body.evidenceId,
    };
    try {
      const existing = await confirm(encoded);
      if (existing.kind === 'received' || existing.kind === 'refused')
        return existing;
      if (recoveryWorker && existing.kind === 'missing')
        return refused('uncertain');
      const body = encoded.body;
      const claim = recoveryWorker
        ? await store.claimCaptureEvidenceReconciliation({
            roundId: body.roundId,
            evidenceId: body.evidenceId,
            workerId: recoveryWorker,
          })
        : await store.reserveCaptureEvidence({
            roundId: body.roundId,
            sessionId: body.sessionId,
            workerId: body.workerId,
            epoch: body.epoch,
            segmentId: body.segmentId,
            roundParticipantId: body.roundParticipantId,
            trackId: body.trackId,
            startOffsetMs: body.startOffsetMs,
            durationMs: body.durationMs,
            before: body.before,
            after: body.after,
            evidenceId: body.evidenceId,
            bodyDigest: encoded.digest,
            reservedBytes: encoded.byteLength,
          });
      if (claim.kind !== 'claimed') return pending;
      // Exact original body/history and stored subjects are checked before the first custody side effect.
      const original = await store.readCaptureEvidencePayload({ body });
      if (original.kind === 'received') {
        const confirmed = await confirm(encoded);
        return confirmed.kind === 'received' || confirmed.kind === 'refused'
          ? confirmed
          : pending;
      }
      if (
        original.kind !== 'pending' ||
        original.bindingDigest !== claim.bindingDigest
      )
        return refused('uncertain');
      const sealed = await custody.seal(
        { evidenceId: body.evidenceId, bindingDigest: claim.bindingDigest },
        Buffer.from(encoded.json),
        original.privacyScope,
      );
      if (sealed.kind === 'refused') return sealed;
      const checked = evidenceEnvelopeSchema.safeParse(sealed);
      if (
        !checked.success ||
        sealed.receipt.evidenceId !== body.evidenceId ||
        sealed.receipt.bindingDigest !== claim.bindingDigest
      )
        return refused('invalid');
      const denial = await authenticated(
        encoded,
        checked.data,
        original.privacyScope,
      );
      if (denial) return denial;
      await store.adoptCaptureEvidence({
        body,
        sealed: checked.data,
        claim: {
          workerId: recoveryWorker ?? body.workerId,
          executionEpoch: claim.executionEpoch,
          token: claim.token,
        },
      });
      const confirmed = await confirm(encoded);
      return confirmed.kind === 'received' || confirmed.kind === 'refused'
        ? confirmed
        : pending;
    } catch (error) {
      if (isAppError(error)) {
        if (error.code === 'VALIDATION') return refused('invalid');
        if (error.code === 'AUTHORIZATION') return refused('uncertain');
        if (error.code === 'CONFLICT') return refused('conflict');
      }
      // An unavailable/lost COMMIT reply is not absence and must never trigger premature key revocation.
      try {
        const confirmed = await confirm(encoded);
        if (confirmed.kind === 'received' || confirmed.kind === 'refused')
          return confirmed;
      } catch {
        /* Durable original intent/payload remains pending; no usable acknowledgement. */
      }
      return pending;
    }
  };
  return {
    restore: createStoredEvidenceRestore({ store, custody }),
    receive(raw: unknown): Promise<NecessaryEvidenceIngressReply> {
      const encoded = prepareEvidenceBody(raw);
      return encoded
        ? receivePrepared(encoded)
        : Promise.resolve(refused('invalid'));
    },
    recover(
      raw: unknown,
      workerId: string,
    ): Promise<NecessaryEvidenceIngressReply> {
      const encoded = prepareEvidenceBody(raw);
      return encoded && idSchema.safeParse(workerId).success
        ? receivePrepared(encoded, workerId)
        : Promise.resolve(refused('invalid'));
    },
  };
}
