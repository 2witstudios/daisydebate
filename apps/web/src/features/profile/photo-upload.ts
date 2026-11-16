import {
  PROFILE_PHOTO_MAX_BYTES,
  profilePhotoMimes,
  profilePhotoRefusals,
  profilePhotoUploadResultSchema,
  type ProfilePhotoRefusal,
} from '@daisy/protocol/public-profile';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * What a photo upload came to, as the member's browser hears it (ADR 0143).
 * `accepted` names where the photo stands: `published` for everyone, or
 * `in_review` for its owner alone until an operator decides. A lost answer is
 * `unavailable`: nothing the member did is wrong.
 */
export type PhotoUploadOutcome =
  | { readonly kind: 'accepted'; readonly status: 'published' | 'in_review' }
  | { readonly kind: 'refused'; readonly refusal: ProfilePhotoRefusal }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unavailable' };

/** What clearing the photo came to. */
export type PhotoRemovalOutcome =
  | { readonly kind: 'removed' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unavailable' };

/** Each refusal word, in plain language: a new word fails to compile until it has copy. */
export const photoRefusalCopy: Readonly<Record<ProfilePhotoRefusal, string>> = {
  'photo-type-unsupported': 'Choose a JPEG, PNG or WebP image.',
  'photo-too-large': 'That photo is over 5 MB. Choose a smaller one.',
  'photo-unreadable': 'That file could not be read as an image. Try another.',
  'photo-malware': 'That file did not pass the safety scan. Choose another.',
  'photo-blocked': 'That photo can’t be used on Daisy. Choose another.',
  'photo-unavailable':
    'Photo uploads are unavailable right now. Try again later.',
};

const tooMany = 'Too many changes at once. Try again in a minute.';

/** What the photo control says after an upload. */
export function photoUploadNotice(outcome: PhotoUploadOutcome): string {
  switch (outcome.kind) {
    case 'accepted':
      return outcome.status === 'published'
        ? 'Photo updated.'
        : 'Photo uploaded. Only you see it until it is reviewed.';
    case 'refused':
      return photoRefusalCopy[outcome.refusal];
    case 'rate-limited':
      return tooMany;
    case 'unavailable':
      return 'Could not upload the photo. Try again.';
  }
}

/** What the photo control says after Remove photo. */
export function photoRemovalNotice(outcome: PhotoRemovalOutcome): string {
  switch (outcome.kind) {
    case 'removed':
      return 'Photo removed.';
    case 'rate-limited':
      return tooMany;
    case 'unavailable':
      return 'Could not remove the photo. Try again.';
  }
}

const isRefusal = (value: unknown): value is ProfilePhotoRefusal =>
  (profilePhotoRefusals as readonly unknown[]).includes(value);

const isPhotoMime = (type: string): boolean =>
  (profilePhotoMimes as readonly string[]).includes(type);

/**
 * The refusal the browser can tell before sending anything, or null. The
 * server checks the same bounds again on the bytes themselves.
 */
export function localPhotoRefusal(file: {
  readonly type: string;
  readonly size: number;
}): ProfilePhotoRefusal | null {
  if (!isPhotoMime(file.type)) return 'photo-type-unsupported';
  if (file.size > PROFILE_PHOTO_MAX_BYTES) return 'photo-too-large';
  return null;
}

const refusalOf = async (response: Response): Promise<unknown> => {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === 'object' && body !== null && 'refusal' in body
    ? body.refusal
    : null;
};

/**
 * Posts the photo as the request body with its own type: a server action
 * caps bodies at 16 KiB, so the photo has its own route (ADR 0143).
 */
export async function uploadProfilePhoto(
  fetch: FetchLike,
  file: Blob,
): Promise<PhotoUploadOutcome> {
  const local = localPhotoRefusal(file);
  if (local) return { kind: 'refused', refusal: local };
  try {
    const response = await fetch('/api/profile/photo', {
      method: 'POST',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (response.ok) {
      const result = profilePhotoUploadResultSchema.safeParse(
        await response.json().catch(() => null),
      );
      return result.success
        ? { kind: 'accepted', status: result.data.status }
        : { kind: 'unavailable' };
    }
    if (response.status === 429) return { kind: 'rate-limited' };
    const refusal = await refusalOf(response);
    return isRefusal(refusal)
      ? { kind: 'refused', refusal }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Clears every live photo: the published one and any in review. */
export async function removeProfilePhoto(
  fetch: FetchLike,
): Promise<PhotoRemovalOutcome> {
  try {
    const response = await fetch('/api/profile/photo', { method: 'DELETE' });
    if (response.ok) return { kind: 'removed' };
    return response.status === 429
      ? { kind: 'rate-limited' }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
