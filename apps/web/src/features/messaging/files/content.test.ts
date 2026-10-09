import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireFileSignature } from './content';
setupRitewayBun();
test('signature validation rejects MIME spoofing and malformed PDF boundaries', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\nhello\n%%EOF\n');
  assert({
    given: 'bounded PDF bytes with header and EOF',
    should: 'preserve the actual MIME',
    actual: requireFileSignature(pdf, 'application/pdf'),
    expected: 'application/pdf',
  });
  for (const [bytes, mime] of [
    [pdf, 'image/png'],
    [new TextEncoder().encode('<script>'), 'application/pdf'],
  ] as const)
    await assertRejects({
      given: 'spoofed or incomplete content',
      should: 'refuse validation',
      actual: () => requireFileSignature(bytes, mime),
      code: 'VALIDATION',
    });
});
