import sharp from 'sharp';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { sanitizeMessagingImage } from './image-sanitizer';
setupRitewayBun();
test('image adapter actually decodes and strips private metadata', async () => {
  const input = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 1, g: 2, b: 3 },
    },
  })
    .withExif({ IFD0: { Copyright: 'Private test subject' } })
    .jpeg()
    .toBuffer();
  const before = await sharp(input).metadata();
  const output = await sanitizeMessagingImage(input, 'image/jpeg', {
    maxPixels: 4,
    maxBytes: 4096,
    serviceMs: 1000,
  });
  const after = await sharp(output).metadata();
  assert({
    given: 'a real JPEG containing private EXIF',
    should: 'decode while dropping input metadata',
    actual: {
      sourceExif: before.exif !== undefined,
      exif: after.exif,
      width: after.width,
      height: after.height,
    },
    expected: { sourceExif: true, exif: undefined, width: 2, height: 2 },
  });
  await assertRejects({
    given: 'a decoded image beyond its explicit pixel bound',
    should: 'refuse processing',
    actual: () =>
      sanitizeMessagingImage(input, 'image/jpeg', {
        maxPixels: 3,
        maxBytes: 4096,
        serviceMs: 1000,
      }),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'signature-like truncated PNG bytes',
    should: 'refuse full decode',
    actual: () =>
      sanitizeMessagingImage(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        'image/png',
        { maxPixels: 100, maxBytes: 4096, serviceMs: 1000 },
      ),
    code: 'VALIDATION',
  });
});
