import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { parseMessagingFileForm, fileFormUnavailable } from './file-form';
setupRitewayBun();
test('native attachment binds message and channel while retaining retry metadata only', async () => {
  const form = new FormData();
  form.set('requestId', 'r'.repeat(24));
  form.set(
    'file',
    new File([new Uint8Array([1, 2, 3])], 'report.pdf', {
      type: 'application/pdf',
    }),
  );
  const parsed = parseMessagingFileForm('c'.repeat(24), 'm'.repeat(24), form);
  assert({
    given: 'a bounded native file choice with trusted route binding',
    should: 'preserve only intent and public retry metadata',
    actual: [
      parsed.channelId,
      parsed.messageId,
      parsed.file.name,
      parsed.file.size,
      fileFormUnavailable(form).requestId,
    ],
    expected: ['c'.repeat(24), 'm'.repeat(24), 'report.pdf', 3, 'r'.repeat(24)],
  });
  form.append(
    'file',
    new File(['other'], 'second.pdf', { type: 'application/pdf' }),
  );
  await assertRejects({
    given: 'ambiguous multi-file field for one reservation',
    should: 'refuse before admission/storage',
    actual: async () =>
      parseMessagingFileForm('c'.repeat(24), 'm'.repeat(24), form),
    code: 'VALIDATION',
  });
});
