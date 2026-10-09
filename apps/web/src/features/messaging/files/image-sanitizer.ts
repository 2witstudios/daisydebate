import sharp from 'sharp';
import { createAppError } from '@daisy/errors';
import type { ImageSanitizer } from './ports';
/** Sharp 0.35.5 decodes under pixel/time limits and drops all input metadata by default. */
export const sanitizeMessagingImage: ImageSanitizer = async (
  bytes,
  mime,
  limits,
) => {
  if (
    [limits.maxPixels, limits.maxBytes, limits.serviceMs].some(
      (n) => !Number.isSafeInteger(n) || n < 1,
    )
  )
    throw createAppError('INFRASTRUCTURE');
  try {
    const image = sharp(bytes, {
      limitInputPixels: limits.maxPixels,
      failOn: 'warning',
      animated: false,
    });
    const metadata = await image.metadata();
    const format =
      mime === 'image/jpeg' ? 'jpeg' : mime === 'image/png' ? 'png' : 'webp';
    if (
      metadata.format !== format ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > limits.maxPixels ||
      (metadata.pages ?? 1) !== 1
    )
      throw createAppError('VALIDATION');
    const output = await image
      .timeout({ seconds: Math.max(1, Math.ceil(limits.serviceMs / 1000)) })
      .rotate()
      .toFormat(format)
      .toBuffer();
    if (output.length > limits.maxBytes)
      throw createAppError('PAYLOAD_TOO_LARGE');
    return new Uint8Array(output);
  } catch {
    throw createAppError('VALIDATION');
  }
};
