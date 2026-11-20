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
        digest:
          '6404e5a8722c4f8d86b88c98658bfc14a343d3b4bc0b469bccd2fd7d63a6e2ea',
      },
      {
        kind: 'child-confirmation',
        version: 'draft-1',
        digest:
          '8c30686e85a29e5f886260acc43874c96f681cfaeed07dbb746540cf8a68707e',
      },
    ],
  });
});
