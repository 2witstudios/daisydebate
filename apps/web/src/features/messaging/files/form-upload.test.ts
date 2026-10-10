import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { attachMessagingFormFile } from './form-upload';
setupRitewayBun();
test('native attachment binds reservation, uploaded generation and actual message before finalize', async () => {
  const channelId = 'c'.repeat(24),
    messageId = 'm'.repeat(24),
    fileId = 'f'.repeat(24);
  const form = new FormData();
  form.set('requestId', 'r'.repeat(24));
  form.set(
    'file',
    new File(['%PDF-1.7'], 'notes.pdf', { type: 'application/pdf' }),
  );
  const calls: string[] = [];
  const token = { version: 1, fileId, generation: 1 };
  let wrong = false;
  let changedReservation = false;
  const transport = {
    reserved: (value: { fileId: string; generation: number }) =>
      assert({
        given: 'admitted reservation',
        should: 'expose only current token for pending cleanup',
        actual: [Object.keys(value).sort(), value.fileId, value.generation],
        expected: [['fileId', 'generation'], fileId, 1],
      }),
    reserve: async () => {
      calls.push('reserve');
      return Response.json(
        {
          ...token,
          filename: changedReservation ? 'other.pdf' : 'notes.pdf',
          mime: 'application/pdf',
          bytes: 8,
          expiresAt: '2026-10-10T00:00:00.000Z',
        },
        {
          headers: {
            'x-messaging-file-bytes': '100',
            'x-messaging-filename-units': '50',
          },
        },
      );
    },
    upload: async () => {
      calls.push('upload');
      return Response.json({ ...token, generation: wrong ? 2 : 1 });
    },
    finalize: async (command: unknown) => {
      calls.push('finalize');
      assert({
        given: 'uploaded bytes',
        should: 'bind the selected message and channel',
        actual: command,
        expected: { ...token, channelId, messageId },
      });
      return Response.json(token);
    },
  };
  await attachMessagingFormFile(channelId, messageId, form, transport);
  assert({
    given: 'native file request',
    should: 'complete only in reserve/upload/finalize order',
    actual: calls,
    expected: ['reserve', 'upload', 'finalize'],
  });
  changedReservation = true;
  calls.length = 0;
  await assertRejects({
    given: 'reservation response changes the selected filename',
    should: 'refuse before upload',
    actual: () =>
      attachMessagingFormFile(channelId, messageId, form, transport),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'changed reservation',
    should: 'avoid private byte upload',
    actual: calls,
    expected: ['reserve'],
  });
  changedReservation = false;
  wrong = true;
  calls.length = 0;
  await assertRejects({
    given: 'foreign generation',
    should: 'refuse before finalization',
    actual: () =>
      attachMessagingFormFile(channelId, messageId, form, transport),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'changed upload generation',
    should: 'stop before attachment',
    actual: calls,
    expected: ['reserve', 'upload'],
  });
});
