import { assert, setupRitewayBun, test } from 'riteway/bun';
import { messagingFileResponse } from './download-response';
setupRitewayBun();
test('private download is bounded content with inert filename and no bearer location', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const response = messagingFileResponse({
    bytes,
    filename: 'Report "quoted".pdf',
    mime: 'application/pdf',
    expiresAt: '2026-10-10T00:00:10.000Z',
  });
  assert({
    given: 'fresh authorized private bytes',
    should:
      'download exact bytes without exposing object keys or executable filename header syntax',
    actual: [
      [...new Uint8Array(await response.arrayBuffer())],
      response.headers.get('content-type'),
      response.headers.get('content-disposition'),
      response.headers.get('x-content-type-options'),
      response.headers.has('location'),
    ],
    expected: [
      [1, 2, 3],
      'application/pdf',
      "attachment; filename*=UTF-8''Report%20%22quoted%22.pdf",
      'nosniff',
      false,
    ],
  });
});
