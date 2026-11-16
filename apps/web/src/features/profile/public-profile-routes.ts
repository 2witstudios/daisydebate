import { requireAuthorization } from '@daisy/auth/request-authorization';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { OwnPublicProfile } from '@daisy/db';
import type { OwnCollectionFence } from '@daisy/db/authorization';
import { createAppError, createRefusal, isAppError } from '@daisy/errors';
import {
  isProfilePhotoVisible,
  ownPublicProfileSchema,
  PROFILE_PHOTO_MAX_BYTES,
  profilePhotoRefusals,
  profilePhotoSizeSchema,
  profilePhotoUploadResultSchema,
  profileTextRefusalOfIssues,
  profileTextRefusals,
  publicProfileEditSchema,
  type OwnPublicProfileView,
  type ProfilePhotoStatus,
} from '@daisy/protocol/public-profile';
import type { Identity } from '@daisy/auth';
import type { RefusalReason } from '@daisy/protocol';
import {
  CONTENT_MODERATION_DELIVERY_BOUND_MS,
  idSchema,
} from '@daisy/protocol';
import { requireMemberActor } from '../access/actor';
import { squareWebpRenditions } from '../image-intake/square-renditions';
import type { App } from '../../server/app';
import {
  handleOperation,
  readBytes,
  readJson,
  refusalResponse,
  requireSameOrigin,
  requireSignedIn,
} from '../../server/http';
import {
  evaluatedIdentity,
  memberHttpBoundary,
  runEvaluatedRoute,
} from '../../server/member-boundary';
import { consumeOrThrow } from '../../server/rate-limit';
import { intakeProfilePhoto, PHOTO_UPLOAD_RULE } from './photo/intake';
import { photoObjectKey } from './photo/object-keys';

/** Text edits per member per minute. */
const TEXT_RULE = { windowSeconds: 60, max: 20 } as const;
/** Photo clears per member per minute. */
const WITHDRAW_RULE = { windowSeconds: 60, max: 10 } as const;
/** A stored rendition is well under this; anything larger is not ours. */
const RENDITION_MAX_BYTES = 1_000_000;
/** How long a viewer may keep a published photo: the moderation delivery bound (ADR 0143). */
const PHOTO_CACHE_SECONDS = Math.floor(
  CONTENT_MODERATION_DELIVERY_BOUND_MS / 1000,
);

type Capability =
  'profile.public.read' | 'profile.public.update' | 'profile.public.withdraw';

const own =
  (
    principal: AuthorizationPrincipal,
    capability: Capability,
  ): OwnCollectionFence<{ readonly actorId: string }> =>
  async ({ scope, account }) =>
    requireAuthorization({
      principal,
      capability,
      resource: { kind: 'public_profile', actorId: scope.actorId },
      context: { account },
    });

const viewOf = (
  profile: OwnPublicProfile,
  photoUploads: OwnPublicProfileView['photoUploads'],
): OwnPublicProfileView =>
  ownPublicProfileSchema.parse({
    version: 1,
    displayName: profile.displayName,
    bio: profile.bio,
    photo: { published: profile.published, inReview: profile.inReview },
    photoUploads,
  });

/** Whether the reader is the photo's owner: only they see it in review. */
const viewerOf = (identity: Identity, actorId: string): 'owner' | 'other' =>
  'principal' in identity &&
  identity.principal.kind === 'user' &&
  identity.principal.actorId === actorId
    ? 'owner'
    : 'other';

/** A published photo caches for the moderation bound; anything else never. */
const cacheControlOf = (status: ProfilePhotoStatus) =>
  status === 'published'
    ? `public, max-age=${PHOTO_CACHE_SECONDS}, must-revalidate`
    : 'private, no-store';

/** The declared type without parameters, lower case. */
const mimeOf = (request: Request) =>
  (request.headers.get('content-type') ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();

/**
 * The member's public profile (ADR 0143): read and edit their display name
 * and bio, upload or clear a photo, and the public image route.
 */
export function composePublicProfileRoutes(app: App) {
  const boundary = memberHttpBoundary(app);
  const storage =
    app.profilePhotoObjects && app.imageScanner
      ? { objects: app.profilePhotoObjects, scanner: app.imageScanner }
      : null;
  const uploads = storage ? 'available' : 'unavailable';

  /**
   * A same-origin member route whose refusals answer their closed word: any
   * signed-in account the evaluator decides for reaches `work`, whose own
   * fences then allow what its participant access allows (ADR 0075).
   */
  const gatedOwnRoute = (
    request: Request,
    name: 'profile.public.write' | 'profile.photo.upload',
    refusals: readonly RefusalReason[],
    work: (principal: AuthorizationPrincipal) => Promise<unknown>,
  ) =>
    handleOperation(
      app.logger,
      request,
      name,
      async (requestId) => {
        requireSameOrigin(request, boundary.origin());
        const identity = requireSignedIn(await boundary.identify(request));
        if (!evaluatedIdentity(identity)) throw createAppError('AUTHORIZATION');
        try {
          return Response.json(await work(identity.principal));
        } catch (error) {
          const refused = refusalResponse(error, requestId, refusals);
          if (refused) return refused;
          throw error;
        }
      },
      app.reporter,
    );

  return {
    read: (request: Request) =>
      runEvaluatedRoute(boundary, request, {
        name: 'profile.public.read',
        readOnly: true,
        readInput: async () => null,
        operation: async (_input, principal) => {
          const scope = requireMemberActor(principal);
          return viewOf(
            await app.database.readOwnPublicProfile(
              scope,
              own(principal, 'profile.public.read'),
            ),
            uploads,
          );
        },
        headers: { 'cache-control': 'no-store' },
      }),

    /**
     * Clearing both fields is a withdrawal, which a restricted member keeps.
     * A refused edit answers its closed word (too long, or an `@` handle).
     */
    write: (request: Request) =>
      gatedOwnRoute(
        request,
        'profile.public.write',
        profileTextRefusals,
        async (principal) => {
          const scope = requireMemberActor(principal);
          await consumeOrThrow(
            app.limiter,
            `public-profile:${scope.actorId}`,
            TEXT_RULE,
          );
          const parsed = publicProfileEditSchema.safeParse(
            await readJson(request, 4096),
          );
          if (!parsed.success) {
            const refusal = profileTextRefusalOfIssues(parsed.error.issues);
            throw refusal
              ? createRefusal('VALIDATION', refusal)
              : createAppError('VALIDATION');
          }
          const edit = parsed.data;
          const clearing = edit.displayName === null && edit.bio === null;
          return viewOf(
            await app.database.writePublicProfileText(
              scope,
              {
                profileId: app.ids.next(),
                displayName: edit.displayName,
                bio: edit.bio,
                now: app.clock.now(),
              },
              own(
                principal,
                clearing ? 'profile.public.withdraw' : 'profile.public.update',
              ),
            ),
            uploads,
          );
        },
      ),

    /**
     * The photo is the request body, its type the Content-Type. The budget,
     * the deployment's storage and the member's right to add a photo are
     * all settled before a byte is read; a refusal answers its closed word.
     */
    uploadPhoto: (request: Request) =>
      gatedOwnRoute(
        request,
        'profile.photo.upload',
        profilePhotoRefusals,
        async (principal) => {
          const scope = requireMemberActor(principal);
          const fence = own(principal, 'profile.public.update');
          await consumeOrThrow(
            app.limiter,
            `profile-photo:${scope.actorId}`,
            PHOTO_UPLOAD_RULE,
          );
          if (!storage)
            throw createRefusal('INFRASTRUCTURE', 'photo-unavailable');
          await app.database.readOwnPublicProfile(scope, fence);
          const bytes = await readBytes(request, PROFILE_PHOTO_MAX_BYTES).catch(
            (error: unknown) => {
              throw isAppError(error) && error.code === 'PAYLOAD_TOO_LARGE'
                ? createRefusal('PAYLOAD_TOO_LARGE', 'photo-too-large')
                : error;
            },
          );
          const result = await intakeProfilePhoto(
            principal,
            { mime: mimeOf(request), bytes },
            {
              clock: app.clock,
              ids: app.ids,
              storage,
              classifier: app.profilePhotoClassifier,
              renditions: squareWebpRenditions,
              record: (member, input) =>
                app.database.recordProfilePhoto(member, input, fence),
            },
          );
          return profilePhotoUploadResultSchema.parse({
            version: 1,
            status: result.status,
            profile: viewOf(result.profile, uploads),
          });
        },
      ),

    withdrawPhoto: (request: Request) =>
      runEvaluatedRoute(boundary, request, {
        name: 'profile.photo.withdraw',
        readOnly: false,
        readInput: async () => null,
        operation: async (_input, principal) => {
          const scope = requireMemberActor(principal);
          await consumeOrThrow(
            app.limiter,
            `profile-photo-withdraw:${scope.actorId}`,
            WITHDRAW_RULE,
          );
          return viewOf(
            await app.database.withdrawProfilePhotos(
              scope,
              { now: app.clock.now() },
              own(principal, 'profile.public.withdraw'),
            ),
            uploads,
          );
        },
      }),

    /**
     * A published photo, to anyone, for a minute at a time; a photo in
     * review, to its owner only and never cached. Anything else, including
     * an ended photo or a closed account's, is not found.
     */
    image: async (
      request: Request,
      params: { readonly photoId: string; readonly size: string },
    ) => {
      const photoId = idSchema.safeParse(params.photoId);
      const size = profilePhotoSizeSchema.safeParse(params.size);
      if (!photoId.success || !size.success)
        return new Response(null, { status: 404 });
      try {
        const photo = await app.database.readProfilePhoto(photoId.data);
        if (!photo || !app.profilePhotoObjects)
          return new Response(null, { status: 404 });
        const viewer =
          photo.status === 'published'
            ? 'other'
            : viewerOf(await boundary.identify(request), photo.actorId);
        if (!isProfilePhotoVisible(photo.status, viewer))
          return new Response(null, { status: 404 });
        const cache = cacheControlOf(photo.status);
        const etag = `"${photo.photoId}-${size.data}-${photo.status}"`;
        if (request.headers.get('if-none-match') === etag)
          return new Response(null, {
            status: 304,
            headers: { etag, 'cache-control': cache },
          });
        const bytes = await app.profilePhotoObjects.read(
          photoObjectKey(photo.objectPrefix, size.data),
          RENDITION_MAX_BYTES,
        );
        return new Response(bytes, {
          headers: {
            'content-type': 'image/webp',
            'content-length': String(bytes.byteLength),
            'cache-control': cache,
            etag,
            'x-content-type-options': 'nosniff',
            'content-disposition': 'inline',
          },
        });
      } catch {
        app.logger.log(
          'profile.photo.image.failed',
          {},
          'A profile photo could not be served',
        );
        return new Response(null, {
          status: 503,
          headers: { 'cache-control': 'no-store' },
        });
      }
    },
  };
}
