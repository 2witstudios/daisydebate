import sharp from 'sharp';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { squareWebpRenditions } from './square-renditions';
setupRitewayBun();

const limits = { maxPixels: 10_000, maxBytes: 64_000, serviceMs: 2_000 };

const landscape = () =>
  sharp({
    create: {
      width: 60,
      height: 30,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  })
    .withExif({ IFD0: { Copyright: 'Private test subject' } })
    .jpeg()
    .toBuffer();

test('square renditions: real decode, crop, WebP, no metadata', async () => {
  const input = await landscape();
  const renditions = await squareWebpRenditions(
    input,
    'image/jpeg',
    [32, 16],
    limits,
  );
  const shapes = await Promise.all(
    renditions.map(async ({ size, bytes }) => {
      const meta = await sharp(bytes).metadata();
      return {
        size,
        format: meta.format,
        width: meta.width,
        height: meta.height,
        exif: meta.exif,
      };
    }),
  );
  assert({
    given: 'a landscape JPEG carrying private EXIF and two requested sizes',
    should: 'answer one square WebP per size, without the EXIF',
    actual: shapes,
    expected: [
      { size: 32, format: 'webp', width: 32, height: 32, exif: undefined },
      { size: 16, format: 'webp', width: 16, height: 16, exif: undefined },
    ],
  });
});

test('square renditions refuse what they must not decode', async () => {
  const input = await landscape();
  await assertRejects({
    given: 'bytes whose decoded format is not the declared one',
    should: 'refuse as invalid input',
    actual: () => squareWebpRenditions(input, 'image/png', [32], limits),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'an image beyond the pixel bound',
    should: 'refuse as invalid input',
    actual: () =>
      squareWebpRenditions(input, 'image/jpeg', [32], {
        ...limits,
        maxPixels: 100,
      }),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'an undecodable signature-only PNG',
    should: 'refuse as invalid input',
    actual: () =>
      squareWebpRenditions(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        'image/png',
        [32],
        limits,
      ),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'a rendition size outside the supported range',
    should: 'refuse as a misconfiguration',
    actual: () => squareWebpRenditions(input, 'image/jpeg', [4], limits),
    code: 'INFRASTRUCTURE',
  });
});
