import type { Metadata } from 'sharp';
import { createAppError } from '@daisy/errors';
import type { ImageMime } from './ports';

/** The decode bounds every intake applies before touching pixels. */
export type DecodeLimits = {
  readonly maxPixels: number;
  readonly maxBytes: number;
  readonly serviceMs: number;
};

/** Every bound is a positive safe integer, or the deployment is misconfigured. */
export function requireDecodeLimits(limits: DecodeLimits): void {
  if (
    [limits.maxPixels, limits.maxBytes, limits.serviceMs].some(
      (n) => !Number.isSafeInteger(n) || n < 1,
    )
  )
    throw createAppError('INFRASTRUCTURE');
}

/** The sharp format name each accepted MIME type must decode as. */
export const formatOf = (mime: ImageMime): 'jpeg' | 'png' | 'webp' =>
  mime === 'image/jpeg' ? 'jpeg' : mime === 'image/png' ? 'png' : 'webp';

/** The decoded image is the declared format, one frame, within the pixel bound. */
export function requireImageMetadata(
  metadata: Metadata,
  mime: ImageMime,
  maxPixels: number,
): { readonly width: number; readonly height: number } {
  if (
    metadata.format !== formatOf(mime) ||
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > maxPixels ||
    (metadata.pages ?? 1) !== 1
  )
    throw createAppError('VALIDATION');
  return { width: metadata.width, height: metadata.height };
}

/** sharp's timeout is whole seconds, at least one. */
export const timeoutSeconds = (serviceMs: number): number =>
  Math.max(1, Math.ceil(serviceMs / 1000));
