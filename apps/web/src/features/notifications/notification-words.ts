import type { InboxRow } from '@daisy/db';
import type { CompetitionType, RatingStyle, SeatKind } from '@daisy/protocol';
import { styleLabels } from '../ratings/ladder-labels';

/** What one notification is about, with only the facts its words need. */
export type NotificationSubject = InboxRow extends infer Row
  ? Row extends unknown
    ? Omit<Row, 'id' | 'readAt' | 'surfacedAt'>
    : never
  : never;

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

/**
 * "a casual Freestyle debate", "a ranked Freestyle debate": the challenge's
 * format, never a division (ADR 0156).
 */
export const challengeWhat = (mode: CompetitionType, format: RatingStyle) =>
  `a ${mode} ${styleLabels[format]} debate`;

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
        text: `${subject.debater ? `@${subject.debater}` : 'A debater you follow'} is on air.`,
        href: `/watch/${subject.roundId}`,
      };
    case 'recording_ready':
      return {
        text: 'A recording is ready to watch.',
        href: `/recordings/${subject.roundId}`,
      };
    case 'round_started':
      return {
        text: 'Your Round has started.',
        href: `/rounds/${subject.roundId}`,
      };
    case 'round_decision_released':
      return {
        text: `The decision is in for your Round${subject.opponent ? ` with @${subject.opponent}` : ''}.`,
        href: `/rounds/${subject.roundId}`,
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
    case 'media_release_requested':
      return {
        text: `Your release request to ${subject.recipient} is waiting. It stops working on ${releaseDay(subject.expiresAt)}.`,
        href: mediaReleaseSettings,
      };
    case 'media_release_declined':
      return {
        text: 'Your parent or guardian declined your media release. Your Youth Rounds stay private.',
        href: mediaReleaseSettings,
      };
    case 'media_release_signed':
      return {
        text: 'Your parent signed your media release. Your Youth Rounds can now be published.',
        href: mediaReleaseSettings,
      };
    case 'media_release_club_confirmed':
      return {
        text: 'Your club confirmed a media release for you.',
        href: mediaReleaseSettings,
      };
    case 'media_release_withdrawn':
      return subject.own
        ? {
            text: 'Your media release was withdrawn. Your public Rounds are coming down.',
            href: mediaReleaseSettings,
          }
        : {
            text: `${subject.minor ? `@${subject.minor}` : 'A student'}’s media release was withdrawn. Their public Rounds are coming down.`,
            href: subject.minor
              ? `/profile/${subject.minor}`
              : '/notifications',
          };
    case 'media_release_club_asked':
      return {
        text: `${subject.student ? `@${subject.student}` : 'A student'} asked your club to confirm their media release.`,
        href: `/clubs/${subject.clubHandle}/releases`,
      };
    case 'youth_round_published':
      return {
        text: `Your Round${subject.by ? ` with @${subject.by}` : ''} is now public.`,
        href: `/recordings/${subject.roundId}`,
      };
  }
};

const mediaReleaseSettings = '/settings#media-release';

/** "29 Nov": the day a release request stops working, in UTC. */
const releaseDay = (at: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(at));
