import { createAppError } from '@daisy/errors';
import type { FileMime } from '@daisy/db/messaging-files';
/** Signature is only admission; images also require full bounded decoding. */
export function requireFileSignature(
  bytes: Uint8Array,
  mime: FileMime,
): FileMime {
  const starts = (prefix: readonly number[]) =>
    prefix.every((byte, i) => bytes[i] === byte);
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  const valid =
    mime === 'image/png'
      ? starts([137, 80, 78, 71, 13, 10, 26, 10])
      : mime === 'image/jpeg'
        ? starts([255, 216, 255]) &&
          bytes.at(-2) === 255 &&
          bytes.at(-1) === 217
        : mime === 'image/webp'
          ? ascii(0, 4) === 'RIFF' &&
            ascii(8, 12) === 'WEBP' &&
            bytes.length >= 20 &&
            new DataView(
              bytes.buffer,
              bytes.byteOffset,
              bytes.byteLength,
            ).getUint32(4, true) +
              8 ===
              bytes.length
          : /^%PDF-1\.[0-7]/u.test(ascii(0, 8)) &&
            /%%EOF\s*$/u.test(
              ascii(Math.max(0, bytes.length - 1024), bytes.length),
            );
  if (!valid) throw createAppError('VALIDATION');
  return mime;
}
