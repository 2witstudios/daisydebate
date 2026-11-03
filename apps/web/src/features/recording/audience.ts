import { factReleased } from '@daisy/debate-engine';
import type { CompetitionType, RecordingStatus } from '@daisy/protocol';

/** How far the audience's released media may trail a fact (ADR 0099). */
export const AUDIENCE_RELEASE_MARGIN_MS = 5_000;

export type RecordingViewer =
  | { readonly kind: 'visitor' }
  | {
      readonly kind: 'account';
      readonly userId: string;
      readonly actorId: string;
    };

/**
 * The Round's Broadcast as a named, read-only input. A Round with no Broadcast
 * has no audience delay. One with a Broadcast releases only with its media: the
 * watermark, never the clock.
 */
export type BroadcastRelease =
  | { readonly kind: 'none' }
  | { readonly kind: 'open'; readonly releasedThroughMs: number | null }
  | { readonly kind: 'completed' };

/** The Round as a named, read-only input. */
export type RecordingRound = {
  readonly id: string;
  readonly competitionType: CompetitionType;
  readonly visibility: 'public' | 'unlisted' | 'private';
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
): boolean => {
  if (round.completedAtMs === null) return false;
  if (release.kind === 'none' || release.kind === 'completed') return true;
  return factReleased(round.completedAtMs, release.releasedThroughMs, {
    marginMs: AUDIENCE_RELEASE_MARGIN_MS,
  });
};

/**
 * What this viewer may know of a finished Round. Each permission stands alone:
 * holding one implies nothing about another. Default deny. `open` is whether the
 * Round exists for them at all; a held or private Round answers exactly as a
 * missing one does, so its existence and end cannot be learned early.
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
): RoundEvidencePermissions => {
  if (round.completedAtMs === null) return NOTHING;
  if (seated(round, viewer))
    return { open: true, media: true, transcript: true, result: true };
  if (insider(round, viewer))
    return { open: true, media: true, transcript: false, result: true };
  if (round.visibility === 'private') return NOTHING;
  if (!releasedToAudience(round, release)) return NOTHING;
  const ranked = round.competitionType === 'ranked';
  return { open: true, media: true, transcript: ranked, result: ranked };
};

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
