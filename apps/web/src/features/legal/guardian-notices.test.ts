import { assert, setupRitewayBun, test } from 'riteway/bun';
import { guardianNoticeKinds } from '@daisy/protocol/guardians';
import { servedNotice } from './guardian-notices';

setupRitewayBun();

test('guardian notice versions identify the exact text presented for agreement', () => {
  assert({
    given: 'the served parental consent and child confirmation notices',
    should: 'retain the recorded version and SHA3-256 digest for each text',
    actual: guardianNoticeKinds.map((kind) => {
      const { version, digest } = servedNotice(kind);
      return { kind, version, digest };
    }),
    expected: [
      {
        kind: 'parental-consent',
        version: 'draft-1',
        digest: 'e5ff99776bfa66517ba01d96d3dd3add99f15f1fa0e4a1b23b33ac198dc1d080',
      },
      {
        kind: 'child-confirmation',
        version: 'draft-1',
        digest: '24c61b1638e499d611d1edef99f3dd4be4bc1ef9062fa1e6aea8150d536b4b38',
      },
    ],
  });
});
