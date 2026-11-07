import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('actual custody authenticates the original canonical body before a committed PG payload receipt is returned', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body, encoded }) => {
    const ingress = createNecessaryEvidenceIngress({ store: capture, custody });
    const reply = await ingress.receive(body);
    const stored = await capture.readCaptureEvidencePayload({ body });
    if (stored.kind !== 'received')
      throw new Error('Expected stored synthetic evidence');
    const opened = await custody.open(stored.sealed);
    const [row] =
      await f.sql`select state,octet_length(ciphertext)::integer as bytes from necessary_evidence where id=${body.evidenceId}`;
    assert({
      given:
        'the complete synthetic native body, real persistent custody and actual bounded PG operations',
      should:
        'return metadata only after actual authenticated original bytes are committed, without calling source audio heard or producing transcript',
      actual: {
        kind: reply.kind,
        keys: Object.keys(reply).sort(),
        exact:
          opened.kind === 'opened' &&
          Buffer.from(opened.plaintext).toString('utf8') === encoded.json,
        row,
      },
      expected: {
        kind: 'received',
        keys: [
          'bindingDigest',
          'evidenceId',
          'kind',
          'payloadAcceptedAt',
          'receipt',
        ],
        exact: true,
        row: { state: 'retained', bytes: encoded.byteLength },
      },
    });
  });
});

test('invalid original frame equations are refused before intent or custody acquisition', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body }) => {
    let seals = 0;
    const ingress = createNecessaryEvidenceIngress({
      store: capture,
      custody: {
        ...custody,
        seal: (...args) => {
          seals++;
          return custody.seal(...args);
        },
      },
    });
    const frame = body.frames[0]!;
    const invalid = {
      ...body,
      frames: [
        {
          ...frame,
          clock: {
            ...frame.clock,
            anchor: {
              ...frame.clock.anchor,
              calibration: {
                ...frame.clock.anchor.calibration,
                serverNowMs: frame.clock.anchor.calibration.serverNowMs + 1,
              },
            },
          },
        },
      ],
    };
    const reply = await ingress.receive(invalid);
    const [row] =
      await f.sql`select count(*)::integer as count from necessary_evidence where id=${body.evidenceId}`;
    assert({
      given: 'valid JSON/PCM/header shape with a false original clock equation',
      should: 'refuse before creating durable intent or key material',
      actual: { reply, seals, count: row!.count },
      expected: {
        reply: { kind: 'refused', reason: 'invalid' },
        seals: 0,
        count: 0,
      },
    });
  });
});

test('tampered actual ciphertext cannot become a payload receipt', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body }) => {
    const ingress = createNecessaryEvidenceIngress({
      store: capture,
      custody: {
        ...custody,
        seal: async (...args) => {
          const reply = await custody.seal(...args);
          if (reply.kind === 'sealed')
            reply.ciphertext[0] = reply.ciphertext[0]! ^ 1;
          return reply;
        },
      },
    });
    // The existing custody edge collapses authenticated-decryption exceptions to unavailable.
    const reply = await ingress.receive(body);
    const [row] =
      await f.sql`select state,ciphertext is null as empty,payload_accepted_at is null as unreceived from necessary_evidence where id=${body.evidenceId}`;
    assert({
      given: 'actual AES-GCM output altered before application adoption',
      should:
        'refuse authentication, retain its bounded intent for reconciliation and issue no PCM acknowledgement',
      actual: { reply, row },
      expected: {
        reply: { kind: 'refused', reason: 'unavailable' },
        row: { state: 'acquiring', empty: true, unreceived: true },
      },
    });
  });
});

test('recovery of an existing original intent does not borrow successor capture authority', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body }) => {
    const blocked = createNecessaryEvidenceIngress({
      store: capture,
      custody: {
        ...custody,
        seal: async () => ({ kind: 'refused', reason: 'unavailable' }),
      },
    });
    await blocked.receive(body);
    await f.sql`update necessary_evidence set lease_expires_at=clock_timestamp()-interval '1 millisecond' where id=${body.evidenceId}`;
    await f.sql`update media_worker_leases set epoch=epoch+1,worker_id=${'z'.repeat(24)} where session_id=${body.sessionId}`;
    await f.sql`update media_sessions set ended_at=clock_timestamp() where id=${body.sessionId}`;
    const recovered = await createNecessaryEvidenceIngress({
      store: capture,
      custody,
    }).recover(body, 'z'.repeat(24));
    const [row] =
      await f.sql`select worker_id,capture_epoch,execution_worker_id,execution_epoch,state from necessary_evidence where id=${body.evidenceId}`;
    assert({
      given:
        'an original committed intent/full body but expired execution ownership, replacement capture worker/epoch and closed original session',
      should:
        'authenticate and retain the same original PCM under new execution only, without rewriting original capture rights',
      actual: { kind: recovered.kind, row },
      expected: {
        kind: 'received',
        row: {
          worker_id: body.workerId,
          capture_epoch: body.epoch,
          execution_worker_id: 'z'.repeat(24),
          execution_epoch: 2,
          state: 'retained',
        },
      },
    });
  });
});

test('stored original PCM is privately restored by IDs without sender bytes or an execution token', async () => {
  await withEvidenceIngress(async ({ capture, custody, body, encoded }) => {
    const writer = createNecessaryEvidenceIngress({ store: capture, custody });
    const first = await writer.receive(body);
    const reader = createNecessaryEvidenceIngress({ store: capture, custody });
    const restored = await reader.restore({
      roundId: body.roundId,
      evidenceId: body.evidenceId,
    });
    assert({
      given:
        'only Round/evidence IDs at a new recovery capability after original payload commit',
      should:
        'authenticate/decode the actual stored body and preserve original provenance and receipt without re-sealing or source reconstruction',
      actual: {
        kind: restored.kind,
        original:
          restored.kind === 'restored' &&
          JSON.stringify(restored.body) === encoded.json,
        same:
          restored.kind === 'restored' &&
          JSON.stringify(restored.receipt) === JSON.stringify(first),
      },
      expected: { kind: 'restored', original: true, same: true },
    });
  });
});

test('metadata and a real key cannot manufacture missing pre-receipt audio', async () => {
  await withEvidenceIngress(async ({ capture, custody, body }) => {
    const blocked = createNecessaryEvidenceIngress({
      store: capture,
      custody: {
        ...custody,
        open: async () => ({ kind: 'refused', reason: 'unavailable' }),
      },
    });
    await blocked.receive(body);
    const restored = await createNecessaryEvidenceIngress({
      store: capture,
      custody,
    }).restore({ roundId: body.roundId, evidenceId: body.evidenceId });
    assert({
      given:
        'an actual bounded intent and material key but no committed encrypted payload',
      should:
        'report pending without pretending key custody can recover unheard/unreceived words',
      actual: restored,
      expected: { kind: 'pending', evidenceId: body.evidenceId },
    });
  });
});
