import type { ContentWaiverStanding } from '@daisy/db';
import type { RoomAssemblyState, RoomRefusal } from '@daisy/protocol';
import {
  CONTENT_WAIVER_VERSION,
  casualCaptureNotice,
  type RoundCaptureNotice,
} from '../legal/agreements';

type CompetitionFact = Pick<RoomAssemblyState, 'competitionType'>;
type CaptureFacts = CompetitionFact & Pick<RoomAssemblyState, 'capture'>;

/**
 * The notice this Room shows before Ready: a casual Room whose host chose a
 * broadcast or a recording (WATCH-8). A ranked Room has none; its Ready is
 * fenced by the signed content waiver.
 */
export const roomCaptureNotice = (
  room: CaptureFacts,
): RoundCaptureNotice | null =>
  room.competitionType !== 'ranked' && room.capture
    ? casualCaptureNotice
    : null;

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

/**
 * The notice a create records. A form that showed none records none; one that
 * states a notice must state the Room's own, so nobody is recorded as reading
 * words their form did not show. A ranked Room has no notice to state.
 */
export const createNoticeOf = (
  room: CaptureFacts,
  noticeVersion: string | undefined,
):
  | { readonly kind: 'none' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'shown'; readonly notice: RoundCaptureNotice } => {
  if (noticeVersion === undefined) return { kind: 'none' };
  const notice = roomCaptureNotice(room);
  return notice?.version === noticeVersion
    ? { kind: 'shown', notice }
    : { kind: 'refused' };
};

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
