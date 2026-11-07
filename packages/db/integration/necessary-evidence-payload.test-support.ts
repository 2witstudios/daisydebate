import {
  canonicalCaptureEvidenceBody,
  necessaryEvidencePolicy,
} from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { withBoundedRound } from './bounded-transaction.test-support';
import { configuredCapture } from './necessary-evidence.test-support';
type Inputs = Parameters<Parameters<typeof withBoundedRound>[0]>;
async function prepare(...[f, transaction, roundId, client]: Inputs) {
  const { store, window, original } = await configuredCapture(
    f,
    transaction,
    roundId,
    65536,
    64,
    1000,
    65536,
  );
  await f.sql`update rounds set version=2 where id=${roundId}`;
  const at = original.start.getTime() + 100;
  const [grant] =
    await f.sql`select id from round_speaking_intervals where round_id=${roundId}`;
  const { authorityId, ...nativeWindow } = window;
  const body = {
    version: 1,
    evidenceId: createId(),
    ...nativeWindow,
    intervalId: grant!.id,
    historyVersion: 2,
    historyReadAt: new Date(at + 20).toISOString(),
    segmentStartedAtMs: original.start.getTime(),
    durationMs: 10,
    after: new Date(at + 11).toISOString(),
    frames: [
      {
        pcmS16le: Buffer.alloc(320).toString('base64'),
        clock: {
          observation: { sequence: 0, beforeMs: 10, afterMs: 10 },
          anchor: {
            calibration: {
              sentAtMs: 0,
              receivedAtMs: 0,
              serverNowMs: at,
              precisionMs: 0,
            },
            observation: { sequence: 0, beforeMs: 10, afterMs: 10 },
            previous: null,
          },
          previous: null,
          window: {
            nominalStartMs: at,
            beforeMs: at - 0.001,
            afterMs: at + 10.001,
          },
        },
      },
    ],
  };
  const encoded = canonicalCaptureEvidenceBody(body);
  if (encoded.kind !== 'encoded')
    throw new Error('Invalid synthetic native-body fixture');
  const digest = new Bun.CryptoHasher('sha3-256')
    .update(encoded.json)
    .digest('hex');
  const intent = await store.reserveCaptureEvidence({
    ...window,
    evidenceId: body.evidenceId,
    durationMs: body.durationMs,
    after: body.after,
    bodyDigest: digest,
    reservedBytes: encoded.byteLength,
  });
  if (intent.kind !== 'claimed')
    throw new Error('Synthetic intent not claimed');
  const receivedAtMs = Date.now() - 10;
  // Store-only synthetic ciphertext. Application crypto/body verification is a separate proof.
  const sealed = {
    kind: 'sealed' as const,
    receipt: {
      evidenceId: body.evidenceId,
      bindingDigest: intent.bindingDigest,
      authorityId,
      receivedAtMs,
      expiresAtMs: receivedAtMs + necessaryEvidencePolicy.maxAgeMs,
    },
    ciphertext: Buffer.alloc(encoded.byteLength, 1),
    nonce: Buffer.alloc(12),
    tag: Buffer.alloc(16),
  };
  const claim = {
    workerId: window.workerId,
    executionEpoch: intent.executionEpoch,
    token: intent.token,
  };
  return {
    f,
    transaction,
    client,
    roundId,
    store,
    window,
    original,
    body: encoded.body,
    sealed,
    claim,
    encoded,
    receivedAtMs,
  };
}
export type PayloadFixture = Awaited<ReturnType<typeof prepare>>;
export const withEvidencePayload = (
  work: (fixture: PayloadFixture) => Promise<void>,
) =>
  withBoundedRound(async (...args) => {
    const fixture = await prepare(...args);
    try {
      await work(fixture);
    } finally {
      await fixture.f
        .sql`delete from necessary_evidence where id=${fixture.body.evidenceId}`;
    }
  });
