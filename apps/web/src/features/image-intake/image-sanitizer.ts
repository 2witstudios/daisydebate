import sharp from 'sharp';
import { createAppError, isAppError } from '@daisy/errors';
import {
  formatOf,
  requireDecodeLimits,
  requireImageMetadata,
  timeoutSeconds,
} from './decoded-image';
import type { ImageSanitizer } from './ports';

/** Sharp 0.35.5 decodes under pixel/time limits and drops all input metadata by default. */
export const sanitizeImage: ImageSanitizer = async (bytes, mime, limits) => {
  requireDecodeLimits(limits);
  try {
    const image = sharp(bytes, {
      limitInputPixels: limits.maxPixels,
      failOn: 'warning',
      animated: false,
    });
    requireImageMetadata(await image.metadata(), mime, limits.maxPixels);
    const output = await image
      .timeout({ seconds: timeoutSeconds(limits.serviceMs) })
      .rotate()
      .toFormat(formatOf(mime))
      .toBuffer();
    if (output.length > limits.maxBytes)
      throw createAppError('PAYLOAD_TOO_LARGE');
    return new Uint8Array(output);
  } catch (error) {
    throw isAppError(error) ? error : createAppError('VALIDATION');
  }
};
