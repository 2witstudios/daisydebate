import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { OwnPublicProfile } from '@daisy/db';
import { createRefusal, isAppError } from '@daisy/errors';
import {
  PROFILE_PHOTO_MAX_BYTES,
  profilePhotoMimes,
  profilePhotoSizes,
  type PhotoCheckVerdict,
  type ProfilePhotoMime,
  type ProfilePhotoRefusal,
} from '@daisy/protocol/public-profile';
import type { FileScanner } from '../../image-intake/ports';
import type { SquareRendition } from '../../image-intake/square-renditions';
import type { DecodeLimits } from '../../image-intake/decoded-image';
import { requireMemberActor } from '../../access/actor';
import { checkDecision } from './check-decision';
import { photoObjectKey, photoObjectPrefix } from './object-keys';
import type { PhotoClassifier, ProfilePhotoObjects } from './ports';

/** Uploads per member per hour: a few tries at a good photo, not a feed. */
export const PHOTO_UPLOAD_RULE = { windowSeconds: 3_600, max: 6 } as const;

/** The decode bound: 40 megapixels, a few seconds, renditions well under a megabyte. */
export const PHOTO_DECODE_LIMITS: DecodeLimits = {
  maxPixels: 40_000_000,
  maxBytes: 1_000_000,
  serviceMs: 10_000,
};

/** One uploaded file as the route read it: declared type and bytes. */
export type PhotoUpload = {
  readonly mime: string;
  readonly bytes: Uint8Array;
};

export type PhotoIntakeDependencies = {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly limit: (actorId: string) => Promise<void>;
  /** Null when the deployment has no bucket or no scanner: uploads refuse. */
  readonly storage: {
    readonly objects: ProfilePhotoObjects;
    readonly scanner: FileScanner;
  } | null;
  /** Null when no check is configured: every photo goes to review. */
  readonly classifier: PhotoClassifier | null;
  readonly renditions: (
    bytes: Uint8Array,
    mime: ProfilePhotoMime,
    sizes: readonly number[],
    limits: DecodeLimits,
  ) => Promise<readonly SquareRendition[]>;
  readonly record: (
    scope: { readonly userId: string; readonly actorId: string },
    input: {
      readonly photoId: string;
      readonly objectPrefix: string;
      readonly status: 'published' | 'in_review';
      readonly checkVerdict: PhotoCheckVerdict | null;
      readonly now: string;
    },
  ) => Promise<OwnPublicProfile>;
};

const refuse = (
  code: 'VALIDATION' | 'PAYLOAD_TOO_LARGE' | 'INFRASTRUCTURE',
  reason: ProfilePhotoRefusal,
) => createRefusal(code, reason);

const isMime = (mime: string): mime is ProfilePhotoMime =>
  profilePhotoMimes.some((known) => known === mime);

/** The check's answer, or null when it could not answer: review decides then. */
async function verdictOf(
  classifier: PhotoClassifier | null,
  webp: Uint8Array,
): Promise<PhotoCheckVerdict | null> {
  if (!classifier) return null;
  try {
    return await classifier.check(webp);
  } catch {
    return null;
  }
}

/**
 * A member's new profile photo (ADR 0142): bounded, scanned, decoded and
 * re-encoded as square WebP without metadata, checked, stored, then recorded.
 * Nothing is stored for a refused upload, and a photo the check did not allow
 * is visible only to its owner until an operator decides.
 */
export async function intakeProfilePhoto(
  principal: AuthorizationPrincipal,
  upload: PhotoUpload,
  dependencies: PhotoIntakeDependencies,
): Promise<{
  readonly status: 'published' | 'in_review';
  readonly profile: OwnPublicProfile;
}> {
  const scope = requireMemberActor(principal);
  await dependencies.limit(scope.actorId);
  const { storage } = dependencies;
  if (!storage) throw refuse('INFRASTRUCTURE', 'photo-unavailable');
  if (!isMime(upload.mime))
    throw refuse('VALIDATION', 'photo-type-unsupported');
  if (upload.bytes.byteLength < 1)
    throw refuse('VALIDATION', 'photo-unreadable');
  if (upload.bytes.byteLength > PROFILE_PHOTO_MAX_BYTES)
    throw refuse('PAYLOAD_TOO_LARGE', 'photo-too-large');

  let scanned: 'clean' | 'infected';
  try {
    scanned = await storage.scanner.scan(upload.bytes, {
      maxBytes: PROFILE_PHOTO_MAX_BYTES,
      serviceMs: PHOTO_DECODE_LIMITS.serviceMs,
    });
  } catch {
    throw refuse('INFRASTRUCTURE', 'photo-unavailable');
  }
  if (scanned === 'infected') throw refuse('VALIDATION', 'photo-malware');

  let renditions: readonly SquareRendition[];
  try {
    renditions = await dependencies.renditions(
      upload.bytes,
      upload.mime,
      profilePhotoSizes,
      PHOTO_DECODE_LIMITS,
    );
  } catch (error) {
    throw isAppError(error) && error.code === 'PAYLOAD_TOO_LARGE'
      ? refuse('PAYLOAD_TOO_LARGE', 'photo-too-large')
      : isAppError(error) && error.code === 'INFRASTRUCTURE'
        ? error
        : refuse('VALIDATION', 'photo-unreadable');
  }
  const largest = renditions.find(({ size }) => size === profilePhotoSizes[0]);
  if (!largest) throw refuse('INFRASTRUCTURE', 'photo-unavailable');

  const verdict = await verdictOf(dependencies.classifier, largest.bytes);
  const decision = checkDecision(verdict);
  if (decision.kind === 'refuse') throw refuse('VALIDATION', 'photo-blocked');

  const photoId = dependencies.ids.next();
  const objectPrefix = photoObjectPrefix(photoId);
  const status = decision.kind === 'publish' ? 'published' : 'in_review';
  try {
    for (const size of profilePhotoSizes) {
      const rendition = renditions.find((each) => each.size === size);
      if (!rendition) throw refuse('INFRASTRUCTURE', 'photo-unavailable');
      await storage.objects.put(
        photoObjectKey(objectPrefix, size),
        rendition.bytes,
      );
    }
    const profile = await dependencies.record(scope, {
      photoId,
      objectPrefix,
      status,
      checkVerdict: verdict,
      now: dependencies.clock.now(),
    });
    return { status, profile };
  } catch (error) {
    // Nothing records this photo, so nothing else would delete its objects.
    await storage.objects.removePrefix(objectPrefix).catch(() => undefined);
    throw isAppError(error) ? error : refuse('INFRASTRUCTURE', 'photo-unavailable');
  }
}
