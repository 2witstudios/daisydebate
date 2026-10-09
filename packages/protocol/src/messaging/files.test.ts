import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingFileSchemas } from './files';
setupRitewayBun();
test('file admission requires explicit safe limits and rejects bearer access fields', () => {
  const schema = createMessagingFileSchemas({
    maxFileBytes: 100,
    maxFilenameUnits: 50,
  }).reserve;
  const input = {
    version: 1,
    channelId: 'c'.repeat(24),
    requestId: 'r'.repeat(24),
    bytes: 100,
    mime: 'application/pdf',
    filename: 'notes.pdf',
  };
  assert({
    given: 'a bounded PDF reservation',
    should: 'preserve its request',
    actual: schema.parse(input),
    expected: input,
  });
  for (const change of [
    { bytes: 101 },
    { bytes: 0 },
    { mime: 'text/html' },
    { filename: '../secret' },
    { filename: 'notes\u0000.pdf' },
    { filename: 'notes\u001f.pdf' },
    { filename: 'notes\u007f.pdf' },
    { filename: 'folder\\notes.pdf' },
    { objectKey: 'private' },
    { url: 'https://public' },
  ]) {
    const parsed = schema.safeParse({ ...input, ...change });
    assert({
      given: 'unsafe or over-limit input',
      should: 'report validation issues',
      actual: parsed.error?.issues.length! > 0,
      expected: true,
    });
  }
});
