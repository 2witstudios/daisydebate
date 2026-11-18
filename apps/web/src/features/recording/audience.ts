import { factReleased } from '@daisy/debate-engine';
import { audienceAdmits } from '../audience-link/audience-link';
import {
  mayTakeDownYouthRecording,
  recordingAudience,
  removableStatus,
  type YouthRound,
} from './youth-audience';
import {
  SPECTATOR_MARGIN_MS,
  type CompetitionType,
  type RecordingPolicy,
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
 * has reached, by the one server rule, and how its Broadcast was stopped. The feed
 * ending is final. Only an operator's stop also withholds the media (`media_withheld`);
 * a feed a Recording's takedown ended (`feed_ended`) leaves that to the Recording's own
 * state, so a restore brings the video back. What follows the delay still leaves.
 */
export type BroadcastRelease = {
  readonly releasedThroughMs: number | null;
  readonly stop: 'none' | 'feed_ended' | 'media_withheld';
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
  /** Who the Recording is for, as every participant was told at Launch (TAB-6.15). */
  readonly recordingPolicy: RecordingPolicy;
  /** The actors in the Round's judge and moderator seats. */
  readonly officialActorIds: readonly string[];
  /**
   * A Youth Round's youth debaters and their linked adults (ADR 0107, PYL-5):
   * a ranked Round on Youth – Freestyle. Null on every other Round.
   */
  readonly youth: YouthRound | null;
};

/**
 * How long a Recording kept for the officials lasts after its Round ends:
 * 14 days, provisional (TAB-6.15; compliance records the period).
 */
export const OFFICIALS_RECORDING_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** When an officials' Recording is deleted; null for any other Recording. */
export const recordingDeletionDueMs = (
  round: Pick<RecordingRound, 'recordingPolicy' | 'completedAtMs'>,
): number | null =>
  round.recordingPolicy === 'officials' && round.completedAtMs !== null
    ? round.completedAtMs + OFFICIALS_RECORDING_RETENTION_MS
    : null;

/** An officials' Recording is for its judge and moderator seats and its host. */
const official = (round: RecordingRound, viewer: RecordingViewer): boolean =>
  viewer.kind === 'account' &&
  (round.officialActorIds.includes(viewer.actorId) ||
    round.hostActorId === viewer.actorId);

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

const EVERYTHING: RoundEvidencePermissions = {
  open: true,
  media: true,
  transcript: true,
  result: true,
};

/**
 * A Youth Round is private whatever its Room's visibility or a presented link:
 * its audience sees all of it once it ends, anyone else answers as missing.
 * Once a debater shared it, and while every release holds and publishing is
 * open, anyone sees it (ADR 0151).
 */
const youthPermissions = (
  round: RecordingRound & { readonly youth: YouthRound },
  viewer: RecordingViewer,
): RoundEvidencePermissions =>
  round.completedAtMs !== null &&
  (round.youth.public || recordingAudience(round, viewer).kind === 'allowed')
    ? EVERYTHING
    : NOTHING;

/**
 * Under the officials policy only the officials and the host see the video, and
 * only until its deletion date; a debater keeps the rest of their own record,
 * and the audience learns nothing of the Round. `nowMs` is the caller's clock.
 */
export const roundEvidencePermissions = (
  round: RecordingRound,
  release: BroadcastRelease,
  viewer: RecordingViewer,
  presentedLinkHash: string | null,
  nowMs: number,
): RoundEvidencePermissions => {
  if (round.youth !== null)
    return youthPermissions({ ...round, youth: round.youth }, viewer);
  const permissions = releasedPermissions(
    round,
    release,
    viewer,
    presentedLinkHash,
  );
  switch (round.recordingPolicy) {
    case 'off':
    case 'released':
      return permissions;
    case 'officials': {
      if (!seated(round, viewer) && !official(round, viewer)) return NOTHING;
      const due = recordingDeletionDueMs(round);
      const kept = due === null || nowMs < due;
      return {
        ...permissions,
        media: permissions.media && kept && official(round, viewer),
      };
    }
  }
};

const releasedPermissions = (
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
    media: release.stop !== 'media_withheld',
    transcript: ranked,
    result: ranked,
  };
};

/** Whether moderation keeps this viewer from a Round's words: ballot reasons too. */
export const moderationHidesText = (
  round: RecordingRound,
  viewer: RecordingViewer,
  hiddenByModeration: boolean,
): boolean => hiddenByModeration && !seated(round, viewer);

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
  moderationHidesText(round, viewer, hiddenByModeration)
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
 * subscription is the WATCH-8 entitlement, read as a named input. Nobody
 * downloads a Youth Round's private Recording.
 */
export const mayDownload = (input: {
  readonly round: Pick<RecordingRound, 'youth'>;
  readonly viewer: RecordingViewer;
  readonly permissions: RoundEvidencePermissions;
  readonly status: RecordingStatus | null;
  readonly subscribed: boolean;
}): boolean =>
  input.round.youth === null &&
  input.viewer.kind === 'account' &&
  input.subscribed &&
  input.permissions.media &&
  input.status === 'ready';

const casualRemoval = (input: {
  readonly recordingClass: 'ranked' | 'casual';
  readonly round: RecordingRound;
  readonly viewer: RecordingViewer;
  readonly status: RecordingStatus | null;
}): boolean =>
  input.recordingClass === 'casual' &&
  seated(input.round, input.viewer) &&
  removableStatus(input.status);

/**
 * Any participant of a casual Recording; nobody on a ranked one, host included,
 * except a Youth Round's, which any youth debater or linked adult may take down.
 */
export const mayRequestRemoval = (input: {
  readonly recordingClass: 'ranked' | 'casual';
  readonly round: RecordingRound;
  readonly viewer: RecordingViewer;
  readonly status: RecordingStatus | null;
}): boolean => {
  const { youth } = input.round;
  if (youth !== null)
    return mayTakeDownYouthRecording({
      round: { ...input.round, youth },
      viewer: input.viewer,
      status: input.status,
    });
  return casualRemoval(input);
};
