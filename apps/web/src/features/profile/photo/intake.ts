import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { OwnPublicProfile } from '@daisy/db';
import { createRefusal, isAppError } from '@daisy/errors';
import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_RENDITION_MAX_BYTES,
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

/** Uploads per member per hour, spent before the body is read: a few tries, not a feed. */
export const PHOTO_UPLOAD_RULE = { windowSeconds: 3_600, max: 6 } as const;

/** The decode bound: 40 megapixels, a few seconds, renditions within the stored bound. */
const PHOTO_DECODE_LIMITS: DecodeLimits = {
  maxPixels: 40_000_000,
  maxBytes: PROFILE_PHOTO_RENDITION_MAX_BYTES,
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
  /** Writes the photo's row, owing its objects' deletion, before any is stored. */
  readonly reserve: (
    scope: { readonly userId: string; readonly actorId: string },
    input: {
      readonly photoId: string;
      readonly objectPrefix: string;
      readonly checkVerdict: PhotoCheckVerdict | null;
      readonly now: string;
      readonly deleteAfter: string;
    },
  ) => Promise<void>;
  /** Makes the reserved photo live once its objects are stored. */
  readonly record: (
    scope: { readonly userId: string; readonly actorId: string },
    input: {
      readonly photoId: string;
      readonly status: 'published' | 'in_review';
      readonly now: string;
    },
  ) => Promise<OwnPublicProfile>;
};

/** How long a reservation waits for its upload before the sweep deletes it. */
const PHOTO_RESERVATION_MS = 3_600_000;

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

/** The upload's declared type and size, before any byte is read for meaning. */
function requireAcceptable(upload: PhotoUpload): ProfilePhotoMime {
  if (!isMime(upload.mime))
    throw refuse('VALIDATION', 'photo-type-unsupported');
  if (upload.bytes.byteLength < 1)
    throw refuse('VALIDATION', 'photo-unreadable');
  if (upload.bytes.byteLength > PROFILE_PHOTO_MAX_BYTES)
    throw refuse('PAYLOAD_TOO_LARGE', 'photo-too-large');
  return upload.mime;
}

/** Malware first: an inconclusive scan is an outage, never a pass. */
async function requireClean(scanner: FileScanner, bytes: Uint8Array) {
  let scanned: 'clean' | 'infected';
  try {
    scanned = await scanner.scan(bytes, {
      maxBytes: PROFILE_PHOTO_MAX_BYTES,
      serviceMs: PHOTO_DECODE_LIMITS.serviceMs,
    });
  } catch {
    throw refuse('INFRASTRUCTURE', 'photo-unavailable');
  }
  if (scanned === 'infected') throw refuse('VALIDATION', 'photo-malware');
}

/** The square renditions, or the refusal that says why there are none. */
async function render(
  dependencies: PhotoIntakeDependencies,
  bytes: Uint8Array,
  mime: ProfilePhotoMime,
): Promise<readonly SquareRendition[]> {
  try {
    return await dependencies.renditions(
      bytes,
      mime,
      profilePhotoSizes,
      PHOTO_DECODE_LIMITS,
    );
  } catch (error) {
    if (!isAppError(error)) throw refuse('VALIDATION', 'photo-unreadable');
    if (error.code === 'PAYLOAD_TOO_LARGE')
      throw refuse('PAYLOAD_TOO_LARGE', 'photo-too-large');
    if (error.code === 'INFRASTRUCTURE') throw error;
    throw refuse('VALIDATION', 'photo-unreadable');
  }
}

const renditionOf = (
  renditions: readonly SquareRendition[],
  size: number,
): SquareRendition => {
  const found = renditions.find((each) => each.size === size);
  if (!found) throw refuse('INFRASTRUCTURE', 'photo-unavailable');
  return found;
};

/**
 * A member's new profile photo (ADR 0143): bounded, scanned, decoded and
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
  // The route has spent the budget and authorized before reading the body.
  const scope = requireMemberActor(principal);
  const { storage } = dependencies;
  if (!storage) throw refuse('INFRASTRUCTURE', 'photo-unavailable');
  const mime = requireAcceptable(upload);
  await requireClean(storage.scanner, upload.bytes);
  const renditions = await render(dependencies, upload.bytes, mime);
  const verdict = await verdictOf(
    dependencies.classifier,
    renditionOf(renditions, profilePhotoSizes[0]).bytes,
  );
  const decision = checkDecision(verdict);
  if (decision.kind === 'refuse') throw refuse('VALIDATION', 'photo-blocked');

  const photoId = dependencies.ids.next();
  const objectPrefix = photoObjectPrefix(photoId);
  const status = decision.kind === 'publish' ? 'published' : 'in_review';
  const sized = profilePhotoSizes.map((size) => ({
    key: photoObjectKey(objectPrefix, size),
    bytes: renditionOf(renditions, size).bytes,
  }));
  const now = dependencies.clock.now();
  try {
    // The row first, owing the deletion: whatever fails after this, the
    // sweep removes what was stored, and nothing here deletes an image a
    // row may already show.
    await dependencies.reserve(scope, {
      photoId,
      objectPrefix,
      checkVerdict: verdict,
      now,
      deleteAfter: new Date(
        new Date(now).getTime() + PHOTO_RESERVATION_MS,
      ).toISOString(),
    });
    const written = await Promise.allSettled(
      sized.map(({ key, bytes }) => storage.objects.put(key, bytes)),
    );
    const failed = written.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    const profile = await dependencies.record(scope, {
      photoId,
      status,
      now: dependencies.clock.now(),
    });
    return { status, profile };
  } catch (error) {
    throw isAppError(error)
      ? error
      : refuse('INFRASTRUCTURE', 'photo-unavailable');
  }
}
