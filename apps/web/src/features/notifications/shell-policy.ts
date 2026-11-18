import {
  isUrgentNotificationKind,
  type NotificationKind,
  type NotificationShell,
} from '@daisy/protocol';

type Recent = NotificationShell['recent'][number];

/** How long an informational toast stays, unless it is hovered or focused. */
export const TOAST_INFORMATIONAL_MS = 10_000;
/** The most toasts on screen at once; the rest are counted in an overflow line. */
export const TOASTS_SHOWN = 3;

/** The badge's words: nothing for none, the count to nine, then "9+". */
export const badgeText = (unread: number): string | null =>
  unread <= 0 ? null : unread > 9 ? '9+' : String(unread);

const counted = /^\(\d+\+?\) /;

/** The document title with the unread count before it, as "(3) Lobby · Daisy". */
export const titleWith = (title: string, unread: number): string => {
  const bare = title.replace(counted, '');
  const badge = badgeText(unread);
  return badge === null ? bare : `(${badge}) ${bare}`;
};

/**
 * Whether a toast of this kind waits for the member. A kind that needs them
 * now, or asks for an answer, stays until dismissed; one that only tells
 * them something goes after a while (ADR 0144).
 */
export const toastWaits = (kind: NotificationKind): boolean => {
  switch (kind) {
    case 'challenge_received':
    case 'challenge_accepted':
    case 'room_invitation':
    case 'friend_request_received':
    case 'round_started':
      return true;
    case 'followed_debater_live':
    case 'recording_ready':
    case 'round_decision_released':
    case 'friend_request_accepted':
    case 'judge_assigned':
    case 'judge_replaced':
    case 'judge_unassigned':
    case 'tournament_draw_changed':
    case 'tournament_room_ready':
    case 'tournament_results_released':
    // Tab's tournament notices tell; the tournament's pages are where to act.
    case 'media_release_requested':
    case 'media_release_declined':
    case 'media_release_signed':
    case 'media_release_club_confirmed':
    case 'media_release_withdrawn':
    case 'media_release_club_asked':
    case 'youth_round_published':
      // A release notice tells; Settings and the club's page are where to act.
      return false;
  }
};

/**
 * Whether a kind is toasted. A challenge is not: its own cards already show
 * it on every page, and a toast over them would hide their answer. It still
 * chimes and raises a desktop alert.
 */
export const toasted = (kind: NotificationKind): boolean => {
  switch (kind) {
    case 'challenge_received':
    case 'challenge_accepted':
      return false;
    case 'followed_debater_live':
    case 'recording_ready':
    case 'room_invitation':
    case 'friend_request_received':
    case 'friend_request_accepted':
    case 'round_started':
    case 'round_decision_released':
    case 'judge_assigned':
    case 'judge_replaced':
    case 'judge_unassigned':
    case 'tournament_draw_changed':
    case 'tournament_room_ready':
    case 'tournament_results_released':
    case 'media_release_requested':
    case 'media_release_declined':
    case 'media_release_signed':
    case 'media_release_club_confirmed':
    case 'media_release_withdrawn':
    case 'media_release_club_asked':
    case 'youth_round_published':
      return true;
  }
};

/**
 * A row as it reached the member: brought back unread (a Round's analysis
 * resurfacing its decision), it is news again under the same id.
 */
export const arrivalKey = (row: Pick<Recent, 'id' | 'surfacedAt'>): string =>
  `${row.id}@${row.surfacedAt}`;

/** Path only: `/rooms/r1?x` and `/rooms/r1` are the same page. */
const pathOf = (href: string) => href.split(/[?#]/)[0]!;

/** The unread notifications the page at `path` already shows the member. */
export const shownOn = (
  recent: readonly Recent[],
  path: string,
): readonly string[] =>
  recent.filter((row) => pathOf(row.href) === path).map((row) => row.id);

/** What a fresh read brings: new rows to present, and which call for an alert. */
export type Arrivals = {
  /** New since the last read, newest first, minus those this page shows or another surface owns. */
  readonly toasts: readonly Recent[];
  /** New ones that need the member now, toasted or not: a sound, a desktop alert. */
  readonly urgent: readonly Recent[];
};

/**
 * The rows a read brings that the tab has not seen. The first read only
 * learns what is there: a member arriving is not interrupted by what was
 * waiting before they came. A row the current page shows is never toasted.
 */
export const arrivalsOf = (input: {
  /** The arrival keys already presented; null before the first read. */
  readonly seen: ReadonlySet<string> | null;
  readonly recent: readonly Recent[];
  readonly path: string;
}): Arrivals => {
  if (input.seen === null) return { toasts: [], urgent: [] };
  const seen = input.seen;
  const here = new Set(shownOn(input.recent, input.path));
  const fresh = input.recent.filter(
    (row) => !seen.has(arrivalKey(row)) && !here.has(row.id),
  );
  return {
    toasts: fresh.filter((row) => toasted(row.kind)),
    urgent: fresh.filter((row) => isUrgentNotificationKind(row.kind)),
  };
};
