import { trainDestinations } from '../train/actions';

export type PlayOptionId = 'ranked' | 'room' | 'bot' | 'events';

export type PlayOption = {
  readonly id: PlayOptionId;
  readonly title: string;
  readonly blurb: string;
  /** Null while the choice is coming soon: it is shown, not offered. */
  readonly href: string | null;
};

/** The open-a-room form: the one place a Room is set up. */
export const openRoomHref = '/play/room';

/**
 * The ways to play beyond joining a listed Room, in the order a visitor most
 * often wants them. The Play dialog lists these over the Lobby, and `/play`
 * lists the same choices as a page before hydration. Practice with a bot is
 * Coming soon, with no link, until `bot-debates` is released to the viewer.
 */
export const playOptionsFor = (botDebates: boolean): readonly PlayOption[] => [
  {
    id: 'ranked',
    title: 'Ranked debate',
    blurb: 'Matched near your rating. Ranked.',
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
    ...(botDebates
      ? { blurb: 'Pick a personality.', href: trainDestinations.bots }
      : { blurb: 'Coming soon.', href: null }),
  },
  {
    id: 'events',
    title: 'Tournaments and leagues',
    blurb: 'Weekly round robins to season championships.',
    href: '/tournaments',
  },
];
