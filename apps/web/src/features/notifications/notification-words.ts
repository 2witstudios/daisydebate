import type {
  CompetitionType,
  RatingLadder,
  SeatKind,
  TournamentNotificationKind,
} from '@daisy/protocol';

/** What one notification is about, with only the facts its words need. */
export type NotificationSubject =
  | {
      readonly kind: TournamentNotificationKind;
      readonly handle: string;
      readonly eventId: string;
      readonly tabRoundId: string;
      readonly roomId: string | null;
    }
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

const ladderName = (format: RatingLadder) =>
  format.charAt(0).toUpperCase() + format.slice(1);

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
  `a ${mode} ${ladderName(format)} debate`;

/**
 * The words and the destination, from the kind and the names read now, so a
 * row can carry no outcome: there is nowhere in it for one (WATCH-12).
 */
export const notificationWords = (
  subject: NotificationSubject,
): { readonly text: string; readonly href: string } => {
  switch (subject.kind) {
    case 'judge_assigned':
      return {
        text: 'You have been assigned to judge.',
        href: `/tournaments/${subject.handle}/events/${subject.eventId}/rounds/${subject.tabRoundId}`,
      };
    case 'judge_replaced':
      return {
        text: 'Your judging assignment has been replaced.',
        href: `/tournaments/${subject.handle}`,
      };
    case 'judge_unassigned':
      return {
        text: 'You have been unassigned from judging.',
        href: `/tournaments/${subject.handle}`,
      };
    case 'tournament_draw_changed':
      return {
        text: 'Your tournament draw has changed.',
        href: `/tournaments/${subject.handle}/events/${subject.eventId}/rounds/${subject.tabRoundId}`,
      };
    case 'tournament_room_ready':
      return {
        text: 'Your tournament Room is ready.',
        href: `/rooms/${subject.roomId}`,
      };
    case 'tournament_results_released':
      return {
        text: 'Your tournament results have been released.',
        href: `/tournaments/${subject.handle}/standings?event=${subject.eventId}`,
      };
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
