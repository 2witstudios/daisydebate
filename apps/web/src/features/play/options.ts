import { trainDestinations } from '../train/actions';

export type PlayOptionId = 'ranked' | 'room' | 'bot' | 'events';

export type PlayOption = {
  readonly id: PlayOptionId;
  readonly title: string;
  readonly blurb: string;
  readonly href: string;
};

/** The open-a-room form: the one place a Room is set up. */
export const openRoomHref = '/play/room';

/** Where every way to play funnels back to. */
export const lobbyHref = '/lobby';

/**
 * The ways to play beyond joining a listed Room, in the order a visitor most
 * often wants them. The Play dialog lists them over the Lobby, and `/play`
 * lists the same choices as a page when no script runs.
 */
export const playOptions: readonly PlayOption[] = [
  {
    id: 'ranked',
    title: 'Ranked match',
    blurb: 'Matched near your rating. Rated.',
    href: '/ranked',
  },
  {
    id: 'room',
    title: 'Open a room',
    blurb: 'Your topic and settings.',
    href: openRoomHref,
  },
  {
    id: 'bot',
    title: 'Practice with a bot',
    blurb: 'Pick a personality.',
    href: trainDestinations.bots,
  },
  {
    id: 'events',
    title: 'Tournaments and leagues',
    blurb: 'Register, or find your next match.',
    href: '/tournaments',
  },
];
