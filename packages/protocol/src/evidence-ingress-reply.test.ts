import { assert, setupRitewayBun, test } from 'riteway/bun';
import { evidenceIngressReplySchema } from './evidence-ingress-reply';
import { necessaryEvidencePolicy } from './necessary-evidence';
setupRitewayBun();
const received = {
  kind: 'received',
  evidenceId: 'a'.repeat(24),
  bindingDigest: 'b'.repeat(64),
  payloadAcceptedAt: new Date(2000).toISOString(),
  receipt: {
    evidenceId: 'a'.repeat(24),
    bindingDigest: 'b'.repeat(64),
    authorityId: 'c'.repeat(24),
    receivedAtMs: 1000,
    expiresAtMs: 1000 + necessaryEvidencePolicy.maxAgeMs,
  },
};
test('evidence receipt rejects key-only, mismatched, renewed and invented hearing acknowledgements', () => {
  const cases = [
    received,
    { ...received, evidenceId: 'd'.repeat(24) },
    { ...received, bindingDigest: 'e'.repeat(64) },
    { ...received, payloadAcceptedAt: new Date(999).toISOString() },
    {
      ...received,
      payloadAcceptedAt: new Date(received.receipt.expiresAtMs).toISOString(),
    },
    {
      ...received,
      receipt: {
        ...received.receipt,
        expiresAtMs: received.receipt.expiresAtMs + 1,
      },
    },
    { ...received, heard: true },
    { kind: 'pending', evidenceId: received.evidenceId },
    {
      kind: 'pending',
      evidenceId: received.evidenceId,
      receipt: received.receipt,
    },
    { kind: 'refused', reason: 'unavailable' },
    { kind: 'refused', reason: 'silence' },
  ];
  assert({
    given:
      'a payload receipt or a key/pending/mismatched/expired/overstated response',
    should:
      'admit only matching historical payload acceptance or explicit non-acknowledgements, never manufacture a hearing/coverage fact',
    actual: cases.map((x) => evidenceIngressReplySchema.safeParse(x).success),
    expected: [
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
    ],
  });
});
