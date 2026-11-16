/** The image formats Daisy accepts from a member: decodable rasters, never SVG. */
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** A malware scan of untrusted bytes; anything inconclusive throws. */
export type FileScanner = {
  scan(
    bytes: Uint8Array,
    limits: { maxBytes: number; serviceMs: number },
  ): Promise<'clean' | 'infected'>;
};

/** Decode and re-encode in the same format, dropping all input metadata. */
export type ImageSanitizer = (
  bytes: Uint8Array,
  mime: ImageMime,
  limits: { maxPixels: number; maxBytes: number; serviceMs: number },
) => Promise<Uint8Array>;
