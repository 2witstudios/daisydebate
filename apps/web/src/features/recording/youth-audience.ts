import type { RecordingStatus } from '@daisy/protocol';
import {
  everyDebaterReleased,
  type MediaReleaseRecord,
} from '@daisy/protocol/media-release';
import type { RecordingRound, RecordingViewer } from './audience';

/**
 * A Youth Round's Recording (ADR 0107, PYL-5): a ranked Round on Youth –
 * Freestyle is recorded as every ranked Round is, but stays private. Its
 * audience is the Round's seated people (debaters and judges) and each youth
 * debater's linked adults (a coach of their school, or a guardian). It is
 * never listed, never broadcast, never downloaded, and any youth debater or
 * linked adult may take it down. It becomes publishable only when every youth
 * debater holds an active media release (S4) and the youth-publishing release
 * flag is open (ADR 0151); a debater then shares it, and it is public on its
 * page and in the archive while every release holds.
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
 * A Youth Round as recording reads it: its people, and whether its Recording
 * is public now (ADR 0151): shared by a debater, every release still holding,
 * and the youth-publishing flag open.
 */
export type YouthRound = YouthRoundPeople & { readonly public: boolean };

/** A Youth Round as these rules read it. */
export type YouthRecordingRound = Pick<
  RecordingRound,
  'seatedActorIds' | 'officialActorIds'
> & { readonly youth: YouthRoundPeople };

export type RecordingAudience =
  | {
      readonly kind: 'allowed';
      readonly as: 'debater' | 'judge' | 'linked_adult';
    }
  | {
      readonly kind: 'denied';
      readonly reason: 'signed_out' | 'not_in_audience';
    };

const allowed = (as: 'debater' | 'judge' | 'linked_adult') =>
  ({ kind: 'allowed', as }) as const;
const denied = (reason: 'signed_out' | 'not_in_audience') =>
  ({ kind: 'denied', reason }) as const;

/**
 * Who may see a Youth Round's Recording. Seated people first: a judge is an
 * official seat, any other seat is a debater's. Then a linked adult of any of
 * its youth debaters. A host who did not sit is not in the audience, and an
 * audience link admits nobody.
 */
export const recordingAudience = (
  round: YouthRecordingRound,
  viewer: RecordingViewer,
): RecordingAudience => {
  if (viewer.kind !== 'account') return denied('signed_out');
  const { actorId } = viewer;
  if (round.officialActorIds.includes(actorId)) return allowed('judge');
  if (round.seatedActorIds.includes(actorId)) return allowed('debater');
  return round.youth.debaters.some((debater) =>
    debater.linkedAdultActorIds.includes(actorId),
  )
    ? allowed('linked_adult')
    : denied('not_in_audience');
};

/**
 * A media release as recording reads it (ADR 0151's named input): whose, of
 * which scope, and whether it was withdrawn.
 */
export type MediaRelease = Pick<
  MediaReleaseRecord,
  'subjectUserId' | 'scope' | 'withdrawnAt'
>;

/**
 * Whether every youth debater holds an active publish release: the one rule
 * in `@daisy/protocol/media-release`. Publishing also needs the
 * youth-publishing release flag, read at the boundary.
 */
export const youthRoundPublishable = (
  { debaters }: Pick<YouthRoundPeople, 'debaters'>,
  releases: readonly MediaRelease[],
): boolean =>
  everyDebaterReleased(
    debaters.map((debater) => debater.userId),
    releases,
  );

/** Whether this youth debater holds an active publish release. */
export const holdsActiveRelease = (
  debater: Pick<YouthDebater, 'userId'>,
  releases: readonly MediaRelease[],
): boolean => everyDebaterReleased([debater.userId], releases);

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
