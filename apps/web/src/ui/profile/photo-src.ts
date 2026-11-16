import type { ProfilePhotoSize } from '@daisy/protocol/public-profile';

/**
 * Where a published profile photo is served (ADR 0143): through the
 * application, never a bucket URL, so a removal takes effect within a minute.
 * No photo is no source, and the avatar falls back to initials.
 */
export const profilePhotoSrc = (
  photoId: string | null,
  size: ProfilePhotoSize,
): string | undefined =>
  photoId === null
    ? undefined
    : `/api/profile-photos/${encodeURIComponent(photoId)}/${size}`;
