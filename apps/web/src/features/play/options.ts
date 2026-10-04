import { trainDestinations } from '../train/actions';

export type PlayOptionId =
  'ranked' | 'practice-room' | 'join-room' | 'bot' | 'tournament';

export type PlayOption = {
  readonly id: PlayOptionId;
  readonly title: string;
  readonly blurb: string;
  readonly href: string;
};

/** The open-a-room form: the one place a practice room is set up. */
export const openRoomHref = '/play/room';

/**
 * The ways to play, in the order a visitor most often wants them. Play is a
 * gateway: each option leads to its own page, and none is a form here.
 */
export const playOptions: readonly PlayOption[] = [
  {
    id: 'ranked',
    title: 'Play ranked',
    blurb: 'Matched near your rating. Rated.',
    href: '/ranked',
  },
  {
    id: 'practice-room',
    title: 'Open a practice room',
    blurb: 'Your settings. Unrated.',
    href: openRoomHref,
  },
  {
    id: 'join-room',
    title: 'Join a room',
    blurb: 'Open tables and live debates.',
    href: '/lobby',
  },
  {
    id: 'bot',
    title: 'Debate a bot',
    blurb: 'Pick a personality.',
    href: trainDestinations.bots,
  },
  {
    id: 'tournament',
    title: 'Enter a tournament',
    blurb: 'Brackets and round robins.',
    href: '/tournaments',
  },
];
