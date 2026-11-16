import type { PhotoCheckVerdict } from '@daisy/protocol/public-profile';

/**
 * Where profile photo renditions live: a private bucket. Nothing outside the
 * application reads it; the image route streams a published photo through.
 */
export type ProfilePhotoObjects = {
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer>>;
  /** Deletes every object under the prefix; deleting nothing succeeds. */
  removePrefix(prefix: string): Promise<void>;
};

/**
 * The automated inappropriate-content check (ADR 0143). It sees the sanitized
 * 512px rendition only. Any failure throws, and the photo goes to review.
 */
export type PhotoClassifier = {
  check(webp: Uint8Array): Promise<PhotoCheckVerdict>;
};
