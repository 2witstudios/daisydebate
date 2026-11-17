import { idSchema } from '@daisy/protocol';
import type { ProfilePhotoSize } from '@daisy/protocol/public-profile';

/**
 * A photo's renditions sit under one prefix named by its own id, so deleting
 * a photo is deleting its prefix. No member id or name is in the key.
 */
export const photoObjectPrefix = (photoId: string): string =>
  `profile-photos/${idSchema.parse(photoId)}`;

export const photoObjectKey = (
  prefix: string,
  size: ProfilePhotoSize,
): string => `${prefix}/${size}.webp`;

/** The prefix every photo object lives under, for walking them all. */
export const photoObjectsRoot = 'profile-photos/';

/** The photo id a stored key names, or null for a key not laid out as ours. */
export const photoIdOfObjectKey = (key: string): string | null => {
  const [root, photoId, file] = key.split('/');
  return `${root}/` === photoObjectsRoot &&
    file !== undefined &&
    idSchema.safeParse(photoId).success
    ? (photoId ?? null)
    : null;
};
