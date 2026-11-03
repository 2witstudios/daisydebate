import { factReleased } from '@daisy/debate-engine';
import { audienceAdmits } from '../audience-link/audience-link';
import {
  SPECTATOR_MARGIN_MS,
  type CompetitionType,
  type RecordingStatus,
} from '@daisy/protocol';

export type RecordingViewer =
  | { readonly kind: 'visitor' }
  | {
      readonly kind: 'account';
      readonly userId: string;
      readonly actorId: string;
    };

/**
 * The audience's timeline for this Round as a named, read-only input: how far it
 * has reached, by the one server rule, and whether its Broadcast was stopped. A
 * stop is final and withholds the media; what follows the delay still leaves.
 */
export type BroadcastRelease = {
  readonly releasedThroughMs: number | null;
  readonly stopped: boolean;
};

/** The Round as a named, read-only input. */
export type RecordingRound = {
  readonly id: string;
  readonly competitionType: CompetitionType;
  readonly visibility: 'public' | 'unlisted' | 'private';
  /** SHA3-256 of an unlisted Round's current link, read fresh on every request. */
  readonly audienceLinkHash: string | null;
  readonly hostActorId: string | null;
  readonly completedAtMs: number | null;
  readonly seatedActorIds: readonly string[];
};

const seated = (round: RecordingRound, viewer: RecordingViewer): boolean =>
  viewer.kind === 'account' && round.seatedActorIds.includes(viewer.actorId);

const insider = (round: RecordingRound, viewer: RecordingViewer): boolean =>
  seated(round, viewer) ||
  (viewer.kind === 'account' && round.hostActorId === viewer.actorId);

/** Whether the audience may yet know this Round has ended. */
const releasedToAudience = (
  round: RecordingRound,
  release: BroadcastRelease,
): boolean =>
  round.completedAtMs !== null &&
  factReleased(round.completedAtMs, release.releasedThroughMs, {
    marginMs: SPECTATOR_MARGIN_MS,
  });

/**
 * What this viewer may know of a finished Round. Each permission stands alone:
 * holding one implies nothing about another. Default deny. `open` is whether the
 * Round exists for them at all; a held or private Round, or an unlisted one
 * without its current link, answers exactly as a missing one does, so its
 * existence and end cannot be learned early.
 */
export type RoundEvidencePermissions = {
  readonly open: boolean;
  readonly media: boolean;
  readonly transcript: boolean;
  readonly result: boolean;
};

const NOTHING: RoundEvidencePermissions = {
  open: false,
  media: false,
  transcript: false,
  result: false,
};

export const roundEvidencePermissions = (
  round: RecordingRound,
  release: BroadcastRelease,
  viewer: RecordingViewer,
  presentedLinkHash: string | null,
): RoundEvidencePermissions => {
  if (round.completedAtMs === null) return NOTHING;
  if (seated(round, viewer))
    return { open: true, media: true, transcript: true, result: true };
  if (insider(round, viewer))
    return { open: true, media: true, transcript: false, result: true };
  if (!audienceAdmits(round, presentedLinkHash)) return NOTHING;
  if (!releasedToAudience(round, release)) return NOTHING;
  const ranked = round.competitionType === 'ranked';
  return {
    open: true,
    media: !release.stopped,
    transcript: ranked,
    result: ranked,
  };
};

/**
 * After moderation hid a Recording the audience gets no text of its Round either; a
 * member seated in it keeps their own record.
 */
export const permissionsAfterModeration = (
  permissions: RoundEvidencePermissions,
  round: RecordingRound,
  viewer: RecordingViewer,
  hiddenByModeration: boolean,
): RoundEvidencePermissions =>
  hiddenByModeration && !seated(round, viewer)
    ? { ...permissions, transcript: false }
    : permissions;

/** What a viewer who may see the media finds; nothing is ever fabricated. */
export type RecordingMediaState =
  'watch' | 'processing' | 'failed' | 'not_recorded' | 'removed';

/** A takedown reads as removal: its reason is never the audience's to learn. */
export const recordingMediaState = (
  status: RecordingStatus | null,
): RecordingMediaState => {
  switch (status) {
    case null:
      return 'not_recorded';
    case 'ready':
      return 'watch';
    case 'requested':
    case 'capturing':
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'taken_down':
    case 'removing':
    case 'removed':
      return 'removed';
  }
};

/**
 * A subscriber may download any Recording they may watch, and no other. The
 * subscription is the WATCH-8 entitlement, read as a named input.
 */
export const mayDownload = (input: {
  readonly viewer: RecordingViewer;
  readonly permissions: RoundEvidencePermissions;
  readonly status: RecordingStatus | null;
  readonly subscribed: boolean;
}): boolean =>
  input.viewer.kind === 'account' &&
  input.subscribed &&
  input.permissions.media &&
  input.status === 'ready';

/** Any participant of a casual Recording; nobody on a ranked one, host included. */
export const mayRequestRemoval = (input: {
  readonly recordingClass: 'ranked' | 'casual';
  readonly round: RecordingRound;
  readonly viewer: RecordingViewer;
  readonly status: RecordingStatus | null;
}): boolean =>
  input.recordingClass === 'casual' &&
  seated(input.round, input.viewer) &&
  input.status !== null &&
  input.status !== 'taken_down' &&
  input.status !== 'removing' &&
  input.status !== 'removed';
