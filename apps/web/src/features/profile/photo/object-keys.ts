import { idSchema } from '@daisy/protocol';
import type { ProfilePhotoSize } from '@daisy/protocol/public-profile';

/**
 * A photo's renditions sit under one prefix named by its own id, so deleting
 * a photo is deleting its prefix. No member id or name is in the key.
 */
export const photoObjectPrefix = (photoId: string): string =>
  `profile-photos/${idSchema.parse(photoId)}`;

export const photoObjectKey = (prefix: string, size: ProfilePhotoSize): string =>
  `${prefix}/${size}.webp`;
