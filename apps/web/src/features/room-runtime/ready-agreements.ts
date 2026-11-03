import type { ContentWaiverStanding } from '@daisy/db';
import type { RoomAssemblyState, RoomRefusal } from '@daisy/protocol';
import {
  CONTENT_WAIVER_VERSION,
  roundCaptureNotice,
  type RoundCapture,
} from '../legal/agreements';

type CompetitionFact = Pick<RoomAssemblyState, 'competitionType'>;
type CaptureFacts = CompetitionFact & Pick<RoomAssemblyState, 'capture'>;

/**
 * What this Room captures for its audience: ranked always; a casual Room when
 * its host chose a broadcast or a recording (WATCH-8).
 */
const roomCapture = (room: CaptureFacts): RoundCapture => {
  if (room.competitionType === 'ranked') return 'ranked';
  return room.capture ? 'opted-in' : 'none';
};

/** The exact notice this Room shows before Ready (WATCH-5, WATCH-9). */
export const roomCaptureNotice = (room: CaptureFacts) =>
  roundCaptureNotice(roomCapture(room));

/**
 * Ready states the notice its form showed, so a stale form cannot be recorded
 * as having read words it never showed.
 */
export const captureNoticeRefusal = (
  room: CaptureFacts,
  noticeVersion: string | undefined,
): Extract<RoomRefusal, 'capture-notice-changed'> | null =>
  roomCaptureNotice(room)?.version === noticeVersion
    ? null
    : 'capture-notice-changed';

/** The waiver version Ready on this Room needs; only ranked needs one. */
export const requiredContentWaiver = (room: CompetitionFact) =>
  room.competitionType === 'ranked' ? CONTENT_WAIVER_VERSION : null;

/** Unsigned is refused; with no season open, ranked play is unavailable. */
export const contentWaiverRefusal = (
  standing: ContentWaiverStanding | null,
): Extract<
  RoomRefusal,
  'content-waiver-required' | 'ranked-unavailable'
> | null =>
  standing === 'unsigned'
    ? 'content-waiver-required'
    : standing === 'no-active-season'
      ? 'ranked-unavailable'
      : null;
