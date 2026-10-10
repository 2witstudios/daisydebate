import sharp from 'sharp';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { openComposedFileFixture } from './messaging-files-composed.test-support';
import { requireFileScannerPort } from './messaging-files.test-support';
import {
  finalizeMessagingFile,
  readMessagingFile,
  uploadMessagingFile,
} from '../src/features/messaging/files/operations';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const port = requireFileScannerPort(process.env.CLAMD_TEST_PORT);

test('actual image consumer scans the original, strips private metadata and scans immutable sanitized output', async () => {
  const f = await openComposedFileFixture(databaseUrl, port);
  try {
    const original = new Uint8Array(
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#123456' },
      })
        .withExif({
          IFD0: { Artist: 'Private author', Copyright: 'Private ownership' },
        })
        .jpeg()
        .toBuffer(),
    );
    const token = await f.quarantine(original, 'image/jpeg', 'portrait.jpg');
    await uploadMessagingFile(token, original, f.principal, f.dependencies);
    await finalizeMessagingFile(
      { ...token, messageId: f.messageId },
      f.principal,
      f.dependencies,
    );
    const access = await readMessagingFile(token, f.principal, f.dependencies);
    const metadata = await sharp(access.bytes).metadata();
    assert({
      given:
        'real Sharp decoding, real daemon scanning and actual stored bytes',
      should:
        'preserve admitted image pixels while removing private input metadata',
      actual: {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        exif: metadata.exif,
        xmp: metadata.xmp,
        mime: access.mime,
      },
      expected: {
        format: 'jpeg',
        width: 2,
        height: 2,
        exif: undefined,
        xmp: undefined,
        mime: 'image/jpeg',
      },
    });
  } finally {
    await f.close();
  }
}, 30000);
