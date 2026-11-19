import type { RecordingStatus } from '@daisy/protocol';
import type { MediaReleaseRecord } from '@daisy/protocol/media-release';
import type { RecordingRound, RecordingViewer } from './audience';

/**
 * A Youth Round's Recording: any Round of a Youth Room, ranked or casual (ADR
 * 0157). It is recorded, listed and watched exactly as an Open Round's is
 * (ADR 0159). Three things differ: each youth debater's linked adults (a coach
 * of their school, or a guardian) see it whatever the Room's visibility; it is
 * reused (downloaded, streamed on) only once every youth debater holds an
 * active media release (ADR 0151); and any youth debater or linked adult may
 * take it down.
 */

/** One youth debater of the Round, with the adults linked to them. */
export type YouthDebater = {
  readonly actorId: string;
  readonly userId: string;
  /** Their coaches and guardians: whose actors may see this Recording. */
  readonly linkedAdultActorIds: readonly string[];
};

/** A Youth Round's people; null on every other Round. */
export type YouthRoundPeople = {
  readonly debaters: readonly YouthDebater[];
};

/**
 * A Youth Round as recording reads it: its people, and whether every youth
 * debater released it for reuse (`reuseFenced` in
 * `@daisy/protocol/media-release`, ADR 0159).
 */
export type YouthRound = YouthRoundPeople & { readonly reusable: boolean };

/** A Youth Round as the takedown rule reads it. */
export type YouthRecordingRound = Pick<RecordingRound, 'officialActorIds'> & {
  readonly youth: YouthRoundPeople;
};

/**
 * A media release as recording reads it (ADR 0151's named input): whose, of
 * which scope, and whether it was withdrawn.
 */
export type MediaRelease = Pick<
  MediaReleaseRecord,
  'subjectUserId' | 'scope' | 'withdrawnAt'
>;

/** A Recording that exists and is not already going: what any removal may act on. */
export const removableStatus = (status: RecordingStatus | null): boolean =>
  status !== null &&
  status !== 'taken_down' &&
  status !== 'removing' &&
  status !== 'removed';

/**
 * Any youth debater of the Round, or an adult linked to one, may take its
 * Recording down, whole and for everyone. A judge may not.
 */
export const mayTakeDownYouthRecording = (input: {
  readonly round: YouthRecordingRound;
  readonly viewer: RecordingViewer;
  readonly status: RecordingStatus | null;
}): boolean => {
  // Unlike casual, a Recording moderation hid may still be asked for: the
  // lifecycle records the removal as owed, paid when the report closes.
  const asked = input.status === 'taken_down' || removableStatus(input.status);
  if (!asked || input.viewer.kind !== 'account') return false;
  const { actorId } = input.viewer;
  // A judge never takes it down, even one who is also a debater's linked adult.
  if (input.round.officialActorIds.includes(actorId)) return false;
  return input.round.youth.debaters.some(
    (debater) =>
      debater.actorId === actorId ||
      debater.linkedAdultActorIds.includes(actorId),
  );
};
