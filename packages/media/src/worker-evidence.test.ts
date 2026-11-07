import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  evidenceIngressReplySchema,
  necessaryEvidencePolicy,
} from '@daisy/protocol';
import { createFrameClock } from './frame-clock';
import { localClient } from './worker-client.test-support';
setupRitewayBun();
const id = (c: string) => c.repeat(24);
const clock = createFrameClock({
  sentAtMs: 0,
  receivedAtMs: 0,
  serverNowMs: 1000,
  precisionMs: 0,
});
clock.observe({ sequence: 0, beforeMs: 10, afterMs: 10 });
const evidence = clock.evidence()!;
const body = {
  version: 1,
  evidenceId: id('a'),
  roundId: id('r'),
  sessionId: id('s'),
  workerId: id('w'),
  epoch: 1,
  segmentId: id('g'),
  roundParticipantId: id('p'),
  trackId: 'native-track',
  intervalId: id('i'),
  historyVersion: 1,
  historyReadAt: new Date(2000).toISOString(),
  segmentStartedAtMs: 0,
  startOffsetMs: 1000,
  durationMs: 10,
  before: new Date(Math.floor(evidence.window.beforeMs)).toISOString(),
  after: new Date(Math.ceil(evidence.window.afterMs)).toISOString(),
  frames: [{ pcmS16le: Buffer.alloc(320).toString('base64'), clock: evidence }],
};
const receipt = {
  kind: 'received',
  evidenceId: body.evidenceId,
  bindingDigest: 'b'.repeat(64),
  payloadAcceptedAt: new Date(2000).toISOString(),
  receipt: {
    evidenceId: body.evidenceId,
    bindingDigest: 'b'.repeat(64),
    authorityId: id('c'),
    receivedAtMs: 1000,
    expiresAtMs: 1000 + necessaryEvidencePolicy.maxAgeMs,
  },
};
test('capture preserves only a matching historical payload receipt and keeps pending as pending', async () => {
  const responses = [
    receipt,
    { kind: 'pending', evidenceId: body.evidenceId },
  ].map((reply) => evidenceIngressReplySchema.parse(reply));
  const f = localClient((n) => Response.json(responses[n - 1]));
  try {
    assert({
      given:
        'the signed evidence route answering a committed receipt followed by explicit pending',
      should:
        'return their distinct states without treating pending or key custody as PCM acceptance',
      actual: [await f.client.preserve(body), await f.client.preserve(body)],
      expected: responses,
    });
  } finally {
    await f.close();
  }
});
test('foreign original evidence refuses before transport can overwrite its scope', async () => {
  const f = localClient(() => Response.json(receipt));
  try {
    await assertRejects({
      given: 'an original body for another worker/session/Round',
      should: 'refuse before signing or rewriting original authority',
      code: 'VALIDATION',
      actual: () => f.client.preserve({ ...body, workerId: id('x') }),
    });
    assert({
      given: 'the foreign body',
      should: 'make no network attempt',
      actual: f.calls(),
      expected: 0,
    });
  } finally {
    await f.close();
  }
});
test('a wrong-unit or key-only response is never a payload acknowledgement', async () => {
  const other = {
    ...receipt,
    evidenceId: id('q'),
    receipt: { ...receipt.receipt, evidenceId: id('q') },
  };
  const keyOnly = { ...receipt, payloadAcceptedAt: undefined };
  for (const reply of [other, keyOnly]) {
    const f = localClient(() => Response.json(reply));
    try {
      await assertRejects({
        given:
          'a response for a different unit or without committed payload acceptance',
        should: 'refuse the unusable reply rather than release original PCM',
        code: 'INFRASTRUCTURE',
        actual: () => f.client.preserve(body),
      });
    } finally {
      await f.close();
    }
  }
});
