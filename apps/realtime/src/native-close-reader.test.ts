import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createNativeCloseReader } from './native-close-reader.test-support';

setupRitewayBun();

test('physical close observation bounds application capture after authenticated pause', () => {
  const reader = createNativeCloseReader();
  reader.consume(1, Buffer.from(JSON.stringify({ v: 1, type: 'ready' })));
  reader.discardApplicationFrames();
  for (let index = 0; index < 1000; index++)
    reader.consume(
      1,
      Buffer.from(JSON.stringify({ v: 1, type: 'pong', id: 'pressure' })),
    );
  const close = Buffer.alloc(2);
  close.writeUInt16BE(4005);
  assert({
    given:
      'authenticated capture followed by drained pressure text and a native close frame',
    should: 'retain the handshake only and still decode the actual close code',
    actual: [reader.frames, reader.consume(8, close), reader.closeCode()],
    expected: [[{ v: 1, type: 'ready' }], true, 4005],
  });
});

test('physical handshake parsing remains strict before close-only observation', () => {
  const reader = createNativeCloseReader();
  let rejected = false;
  try {
    reader.consume(
      1,
      Buffer.from(JSON.stringify({ v: 1, type: 'ready', extra: true })),
    );
  } catch {
    rejected = true;
  }
  assert({
    given: 'an invalid native application frame before the physical pause',
    should: 'refuse it without adding an accepted handshake',
    actual: [rejected, reader.frames.length, reader.closeCode()],
    expected: [true, 0, undefined],
  });
});
