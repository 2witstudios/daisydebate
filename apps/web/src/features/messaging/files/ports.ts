import type { FileMime } from '@daisy/db/messaging-files';
export type PrivateObjectStore = {
  /** Immutable creation; never publish or return a signed bearer URL. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string, maxBytes: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
};
export type FileScanner = {
  scan(
    bytes: Uint8Array,
    limits: { maxBytes: number; serviceMs: number },
  ): Promise<'clean' | 'infected'>;
};
export type ImageSanitizer = (
  bytes: Uint8Array,
  mime: Exclude<FileMime, 'application/pdf'>,
  limits: { maxPixels: number; maxBytes: number; serviceMs: number },
) => Promise<Uint8Array>;
