import type { CompetitionType, RatingLadder, SeatKind } from '@daisy/protocol';
import { ladderLabels } from '../ratings/ladder-labels';

/** What one notification is about, with only the facts its words need. */
export type NotificationSubject =
  | {
      readonly kind: 'followed_debater_live';
      readonly roundId: string;
      readonly debater: string | null;
    }
  | { readonly kind: 'recording_ready'; readonly roundId: string }
  | {
      readonly kind: 'room_invitation';
      readonly roomId: string;
      readonly seat: SeatKind;
      readonly host: string | null;
    }
  | {
      readonly kind: 'challenge_received';
      readonly challenger: string | null;
      readonly mode: CompetitionType;
      readonly format: RatingLadder;
    };

/** "to judge", "to moderate" or "to debate": what the invitation asks of the member. */
export const invitedTo = (seat: SeatKind): string => {
  switch (seat) {
    case 'judge':
      return 'to judge';
    case 'moderator':
      return 'to moderate';
    case 'side':
    case 'speaker':
      return 'to debate';
  }
};

/** "a casual Freestyle debate". */
export const challengeWhat = (mode: CompetitionType, format: RatingLadder) =>
  `a ${mode} ${ladderLabels[format]} debate`;

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
        text: `@${subject.debater ?? 'A debater you follow'} is on air.`,
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
  }
};
