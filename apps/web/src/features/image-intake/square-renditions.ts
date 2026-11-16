import sharp from 'sharp';
import { createAppError, isAppError } from '@daisy/errors';
import {
  requireDecodeLimits,
  requireImageMetadata,
  timeoutSeconds,
  type DecodeLimits,
} from './decoded-image';
import type { ImageMime } from './ports';

/** One square WebP rendition, its edge in pixels. */
export type SquareRendition = {
  readonly size: number;
  readonly bytes: Uint8Array;
};

/**
 * Decodes once under the limits, upright and centre-cropped square, and
 * encodes each size as WebP with no input metadata (sharp drops it unless
 * asked to keep it). Anything undecodable answers VALIDATION.
 */
export async function squareWebpRenditions(
  bytes: Uint8Array,
  mime: ImageMime,
  sizes: readonly number[],
  limits: DecodeLimits,
): Promise<readonly SquareRendition[]> {
  requireDecodeLimits(limits);
  if (
    sizes.length < 1 ||
    sizes.some(
      (size) => !Number.isSafeInteger(size) || size < 16 || size > 2048,
    )
  )
    throw createAppError('INFRASTRUCTURE');
  try {
    const source = sharp(bytes, {
      limitInputPixels: limits.maxPixels,
      failOn: 'warning',
      animated: false,
    });
    requireImageMetadata(await source.metadata(), mime, limits.maxPixels);
    const upright = await source
      .timeout({ seconds: timeoutSeconds(limits.serviceMs) })
      .rotate()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const renditions: SquareRendition[] = [];
    for (const size of sizes) {
      const output = await sharp(upright.data, { raw: upright.info })
        .timeout({ seconds: timeoutSeconds(limits.serviceMs) })
        .resize(size, size, { fit: 'cover', position: 'centre' })
        .webp({ quality: 82 })
        .toBuffer();
      if (output.length > limits.maxBytes)
        throw createAppError('PAYLOAD_TOO_LARGE');
      renditions.push({ size, bytes: new Uint8Array(output) });
    }
    return renditions;
  } catch (error) {
    throw isAppError(error) ? error : createAppError('VALIDATION');
  }
}
