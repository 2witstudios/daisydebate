import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  inspectArchiveDirectory,
  readArchiveBody,
} from '../packages/media/integration/native-sdk-archive.test-support';
setupRitewayBun();

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
