import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * The public profile (ADR 0143): what a member chooses to show others, besides
 * the username and the competitive record. A display name is a label, never an
 * identifier or an authority; the username stays the competitive identity.
 */
export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 160;
/** What a form may post before normalization; anything longer is refused unread. */
const RAW_TEXT_MAX = 1_000;

/**
 * Characters that change how text renders without being text: C0/C1 controls,
 * bidirectional embeddings, overrides and isolates (and the Arabic letter
 * mark), zero-width joiners and spaces, the soft hyphen, the Mongolian vowel
 * separator, Hangul fillers, the blank Braille pattern and the byte-order
 * mark. They let a name look like another, or like nothing, so they go.
 */
const invisible =
  // eslint-disable-next-line no-control-regex -- the control range is the point
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u2800\u3164\uFEFF\uFFA0]/gu;

/** NFC, invisible characters removed, whitespace collapsed to one space, trimmed. */
export const normalizeDisplayName = (raw: string): string =>
  raw.normalize('NFC').replace(invisible, '').replace(/\s+/gu, ' ').trim();

/**
 * NFC and invisible characters removed; spaces collapse within a line, and at
 * most one blank line separates paragraphs.
 */
export const normalizeBio = (raw: string): string =>
  raw
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(invisible, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

/** Length a person sees: code points, not UTF-16 units. */
const codePoints = (text: string): number => [...text].length;

/**
 * Why an edit of the public text is refused, each one thing to tell the
 * member. A display name may not hold an `@` (or a form that folds to it): it
 * would read as somebody's username, the one identity that matters.
 */
export const profileTextRefusals = [
  'display-name-too-long',
  'display-name-handle',
  'bio-too-long',
] as const;
export type ProfileTextRefusal = (typeof profileTextRefusals)[number];

/**
 * Tested on the compatibility form: NFKC folds every `@` look-alike that
 * Unicode marks as one (fullwidth ＠, small ﹫) to `@`.
 */
const handleMark = /@/u;

/** The normalized text's refusal, or null when it may be saved. */
export function profileTextRefusal(text: {
  readonly displayName: string;
  readonly bio: string;
}): ProfileTextRefusal | null {
  if (codePoints(text.displayName) > DISPLAY_NAME_MAX)
    return 'display-name-too-long';
  if (handleMark.test(text.displayName.normalize('NFKC')))
    return 'display-name-handle';
  if (codePoints(text.bio) > BIO_MAX) return 'bio-too-long';
  return null;
}

const rawText = z.string().max(RAW_TEXT_MAX);

/** An empty answer clears the field: null is "not set". */
const orNull = (text: string) => (text === '' ? null : text);

/**
 * The member's own edit of their public text: normalized, then refused with
 * its closed word as the issue message, so a route can answer that word.
 */
export const publicProfileEditSchema = z
  .strictObject({
    version: z.literal(1),
    displayName: rawText,
    bio: rawText,
  })
  .transform((edit) => ({
    version: edit.version,
    displayName: normalizeDisplayName(edit.displayName),
    bio: normalizeBio(edit.bio),
  }))
  .superRefine((edit, context) => {
    const refusal = profileTextRefusal(edit);
    if (refusal) context.addIssue({ code: 'custom', message: refusal });
  })
  .transform((edit) => ({
    version: edit.version,
    displayName: orNull(edit.displayName),
    bio: orNull(edit.bio),
  }));
export type PublicProfileEdit = z.infer<typeof publicProfileEditSchema>;

/** The closed word a refused edit's issues name, if any. */
export const profileTextRefusalOfIssues = (
  issues: readonly { readonly message: string }[],
): ProfileTextRefusal | null =>
  issues
    .map(({ message }) => message)
    .find((message): message is ProfileTextRefusal =>
      (profileTextRefusals as readonly string[]).includes(message),
    ) ?? null;

/**
 * A profile photo's lifecycle. A photo is stored only once it is scanned,
 * sanitized and checked. `uploading`: its row is written before its objects,
 * already owing their deletion, so an upload that never finishes is cleaned
 * up by the ordinary sweep; recording it makes it live. `in_review`: the check was unsure or unavailable, so
 * an operator decides, and only its owner sees it. `published`: shown to
 * everyone. Terminal, with the stored image then deleted: `rejected` (by an
 * operator, from review), `removed` (by an operator, once published),
 * `withdrawn` (by its owner, replacing or clearing it) and `erased` (the
 * account closed). A member has at most one photo in each live status: a
 * published photo stays while its replacement is in review.
 */
export const profilePhotoStatuses = [
  'uploading',
  'in_review',
  'published',
  'rejected',
  'removed',
  'withdrawn',
  'erased',
] as const;
export type ProfilePhotoStatus = (typeof profilePhotoStatuses)[number];

/** The live statuses: a photo that still has its image and may be shown. */
export const liveProfilePhotoStatuses = [
  'in_review',
  'published',
] as const satisfies readonly ProfilePhotoStatus[];

/** The photo is over: its image is deleted or about to be, and nothing shows it. */
export const isProfilePhotoTerminal = (status: ProfilePhotoStatus): boolean =>
  status !== 'in_review' && status !== 'published';

/** Its owner sees a photo from upload until it ends; everyone else once published. */
export const isProfilePhotoVisible = (
  status: ProfilePhotoStatus,
  viewer: 'owner' | 'other',
): boolean =>
  status === 'published' || (viewer === 'owner' && status === 'in_review');

/** What the automated check answers: show it, ask an operator, or refuse it. */
export const photoCheckVerdicts = ['allow', 'review', 'block'] as const;
export type PhotoCheckVerdict = (typeof photoCheckVerdicts)[number];

/** The square renditions stored for every photo, largest first, in pixels. */
export const profilePhotoSizes = [512, 128] as const;
export type ProfilePhotoSize = (typeof profilePhotoSizes)[number];
export const profilePhotoSizeSchema = z.coerce
  .number()
  .pipe(z.union(profilePhotoSizes.map((size) => z.literal(size))));

/** The image types a member may upload; never SVG or anything animated. */
export const profilePhotoMimes = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type ProfilePhotoMime = (typeof profilePhotoMimes)[number];

/**
 * The largest stored rendition: intake refuses a photo whose 512px WebP is
 * bigger, and the image route and the operator read take at most this, so
 * whatever is stored an operator can read (its base64 fits the 1 MB schema).
 */
export const PROFILE_PHOTO_RENDITION_MAX_BYTES = 700_000;

/** The upload bound, before any decode. */
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** A photo upload the member may not make, each word one thing to tell them. */
export type ProfilePhotoRefusal =
  | 'photo-type-unsupported'
  | 'photo-too-large'
  | 'photo-unreadable'
  | 'photo-malware'
  | 'photo-blocked'
  | 'photo-unavailable';

/** The member's public profile as a viewer may see it. */
export const publicProfileSchema = z.strictObject({
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  /** The photo this viewer may see, or null. */
  photo: z
    .strictObject({
      photoId: idSchema,
      status: z.enum(profilePhotoStatuses),
    })
    .nullable(),
});
export type PublicProfile = z.infer<typeof publicProfileSchema>;

/** What can happen to a stored photo after it is recorded. */
export type ProfilePhotoEvent =
  | 'approve' // an operator publishes a photo in review
  | 'reject' // an operator refuses a photo in review
  | 'remove' // an operator takes a published photo down
  | 'withdraw' // its owner replaces or clears it
  | 'erase'; // the account closes

/** The status an event leads to, already there, or refused from here. */
export type ProfilePhotoTransition =
  | { readonly kind: 'moved'; readonly to: ProfilePhotoStatus }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused' };

const moved = (to: ProfilePhotoStatus): ProfilePhotoTransition => ({
  kind: 'moved',
  to,
});
const unchanged: ProfilePhotoTransition = { kind: 'unchanged' };
const refused: ProfilePhotoTransition = { kind: 'refused' };

/** An operator's move: the one status it applies to, and where it leads. */
const operatorMoves = {
  approve: { from: 'in_review', to: 'published' },
  reject: { from: 'in_review', to: 'rejected' },
  remove: { from: 'published', to: 'removed' },
} as const satisfies Record<
  Exclude<ProfilePhotoEvent, 'withdraw' | 'erase'>,
  { readonly from: ProfilePhotoStatus; readonly to: ProfilePhotoStatus }
>;

/**
 * The photo lifecycle, total over status × event. A repeat of the command that
 * put a photo where it is answers `unchanged`; anything else from a terminal
 * status is refused, except erasure, which ends a live photo or an upload in
 * flight.
 */
export function profilePhotoTransition(
  status: ProfilePhotoStatus,
  event: ProfilePhotoEvent,
): ProfilePhotoTransition {
  // Erasure ends an upload in flight too; a withdrawal has none to end.
  if (event === 'erase')
    return status === 'uploading' || !isProfilePhotoTerminal(status)
      ? moved('erased')
      : unchanged;
  if (event === 'withdraw')
    return isProfilePhotoTerminal(status) ? unchanged : moved('withdrawn');
  const move = operatorMoves[event];
  if (status === move.from) return moved(move.to);
  return status === move.to ? unchanged : refused;
}

/** The member's own public profile, as Settings edits it. */
export const ownPublicProfileSchema = z.strictObject({
  version: z.literal(1),
  displayName: z.string().nullable(),
  bio: z.string().nullable(),
  photo: z.strictObject({
    /** The photo everyone sees. */
    published: idSchema.nullable(),
    /** A newer photo only its owner sees, until an operator decides. */
    inReview: idSchema.nullable(),
  }),
  /** Whether this deployment can take a photo upload at all. */
  photoUploads: z.enum(['available', 'unavailable']),
});
export type OwnPublicProfileView = z.infer<typeof ownPublicProfileSchema>;

/** What a photo upload answers: where the new photo stands, and the profile. */
export const profilePhotoUploadResultSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(['published', 'in_review']),
  profile: ownPublicProfileSchema,
});

/** Every word a photo upload may answer with, for the route to expose. */
export const profilePhotoRefusals = [
  'photo-type-unsupported',
  'photo-too-large',
  'photo-unreadable',
  'photo-malware',
  'photo-blocked',
  'photo-unavailable',
] as const satisfies readonly ProfilePhotoRefusal[];
