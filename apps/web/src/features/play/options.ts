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
    blurb:
      'Daisy matches you with a debater near your rating, and a judge is assigned. Your rating is on the line.',
    href: '/ranked',
  },
  {
    id: 'practice-room',
    title: 'Open a practice room',
    blurb:
      'Pick the settings and wait for an opponent. Results never change a rating.',
    href: openRoomHref,
  },
  {
    id: 'join-room',
    title: 'Join a room',
    blurb: 'Take a seat at an open table, or watch a debate that is live.',
    href: '/lobby',
  },
  {
    id: 'bot',
    title: 'Debate a bot',
    blurb: 'Choose a personality and debate it whenever you like.',
    href: trainDestinations.bots,
  },
  {
    id: 'tournament',
    title: 'Enter a tournament',
    blurb: 'Compete in organised events, with brackets and results.',
    href: '/tournaments',
  },
];
