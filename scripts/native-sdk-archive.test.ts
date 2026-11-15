import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  inspectArchiveDirectory,
  inspectVendorSource,
  readArchiveBody,
} from '../packages/media/integration/native-sdk-archive.test-support';
setupRitewayBun();

test('vendor identity uses Git blob framing and does not invent a tag in the main build', () => {
  const plain = inspectVendorSource(Buffer.from('hello\n'));
  const helper = inspectVendorSource(
    Buffer.from('pub const WEBRTC_TAG: &str = "webrtc-89d790b";'),
  );
  assert({
    given: 'a known Git blob without a tag and a distinct tag-bearing helper',
    should:
      'identify content independently of its saved filename and read the tag only where declared',
    actual: {
      blob: plain.gitBlob,
      mainTag: plain.prebuiltTag,
      helperTag: helper.prebuiltTag,
    },
    expected: {
      blob: 'ce013625030ba8dba906f756967f9e9ca394464a',
      mainTag: null,
      helperTag: 'webrtc-89d790b',
    },
  });
});

test('archive acquisition refuses an oversized stream before accepting excess bytes', async () => {
  let accepted = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(4));
      controller.close();
    },
  });
  const result = await readArchiveBody(body, 6, async (chunk) => {
    accepted += chunk.length;
  }).then(
    () => 'accepted',
    () => 'refused',
  );
  assert({
    given: 'a body exceeding the remaining aggregate allowance',
    should: 'refuse without forwarding the excess chunk',
    actual: { result, accepted },
    expected: { result: 'refused', accepted: 4 },
  });
});

test('central directory sizes do not require expansion and malformed counts refuse', () => {
  const bytes = Buffer.alloc(68);
  bytes.writeUInt32LE(0x02014b50, 0);
  bytes.writeUInt32LE(7, 20);
  bytes.writeUInt32LE(1000, 24);
  bytes.writeUInt32LE(0x06054b50, 46);
  bytes.writeUInt16LE(1, 54);
  bytes.writeUInt16LE(1, 56);
  bytes.writeUInt32LE(46, 58);
  const observed = inspectArchiveDirectory(bytes);
  bytes.writeUInt16LE(2, 56);
  let refused = false;
  try {
    inspectArchiveDirectory(bytes);
  } catch {
    refused = true;
  }
  assert({
    given: 'one central-directory member followed by an inconsistent count',
    should:
      'report expanded metadata without inflation and refuse malformed input',
    actual: { observed, refused },
    expected: {
      observed: {
        entries: 1,
        expandedBytes: 1000,
        compressedMemberBytes: 7,
        directoryBytes: 46,
      },
      refused: true,
    },
  });
});
