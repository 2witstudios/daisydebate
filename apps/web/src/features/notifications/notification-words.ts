import type { InboxRow } from '@daisy/db';
import type {
  CompetitionType,
  RatingLadder,
  RoomSeatKind,
} from '@daisy/protocol';

/** What one notification is about, with only the facts its words need. */
export type NotificationSubject = InboxRow extends infer Row
  ? Row extends unknown
    ? Omit<Row, 'id' | 'readAt' | 'surfacedAt'>
    : never
  : never;

const ladderName = (format: RatingLadder) =>
  format.charAt(0).toUpperCase() + format.slice(1);

/** "to judge" or "to debate": what the invitation asks of the member. */
export const invitedTo = (seat: RoomSeatKind) =>
  seat === 'judge' ? 'to judge' : 'to debate';

/** "a casual Freestyle debate". */
export const challengeWhat = (mode: CompetitionType, format: RatingLadder) =>
  `a ${mode} ${ladderName(format)} debate`;

/**
 * The words and the destination, from the kind and the names read now, so a
 * row can carry no outcome: there is nowhere in it for one (WATCH-12).
 */
export const notificationWords = (
  subject: NotificationSubject,
): { readonly text: string; readonly href: string } => {
  switch (subject.kind) {
    case 'followed_debater_live':
      return {
        text: `${subject.debater ? `@${subject.debater}` : 'A debater you follow'} is on air.`,
        href: `/watch/${subject.roundId}`,
      };
    case 'recording_ready':
      return {
        text: 'A recording is ready to watch.',
        href: `/recordings/${subject.roundId}`,
      };
    case 'room_invitation':
      return {
        text: `${subject.host ? `@${subject.host}` : 'A host'} invited you ${invitedTo(subject.seat)}.`,
        href: `/rooms/${subject.roomId}`,
      };
    case 'challenge_received':
      return {
        text: `${subject.challenger ? `@${subject.challenger}` : 'A member'} challenged you to ${challengeWhat(subject.mode, subject.format)}.`,
        href: '/friends',
      };
    case 'challenge_accepted':
      return {
        text: `${subject.opponent ? `@${subject.opponent}` : 'A member'} accepted your challenge. Your room is ready.`,
        href: `/rooms/${subject.roomId}`,
      };
    case 'friend_request_received':
      return {
        text: `${subject.friend ? `@${subject.friend}` : 'A member'} wants to be friends.`,
        href: '/friends',
      };
    case 'friend_request_accepted':
      return {
        text: `${subject.friend ? `@${subject.friend}` : 'A member'} accepted your friend request.`,
        href: '/friends',
      };
  }
};
