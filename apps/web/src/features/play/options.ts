import type { DestinationSlug } from '../coming-soon/destinations';
import { destinationHref, launched } from '../coming-soon/launch';
import { trainDestinations } from '../train/actions';

export type PlayOptionId = 'ranked' | 'room' | 'bot' | 'events';

export type PlayOption = {
  readonly id: PlayOptionId;
  readonly title: string;
  readonly blurb: string;
  readonly href: string;
  /** Its destination is not launched: the link goes to the explainer. */
  readonly comingSoon: boolean;
};

type PlayChoice = Omit<PlayOption, 'comingSoon'> & {
  /** The destination it opens into, when that has a launch flag. */
  readonly launch?: DestinationSlug;
};

/** The open-a-room form: the one place a Room is set up. */
export const openRoomHref = '/play/room';

const choices: readonly PlayChoice[] = [
  {
    id: 'ranked',
    title: 'Ranked match',
    blurb: 'Matched near your rating. Rated.',
    href: '/ranked',
    launch: 'ranked',
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
    launch: 'train',
  },
  {
    id: 'events',
    title: 'Tournaments and leagues',
    blurb: 'Register, or find your next match.',
    href: '/tournaments',
    launch: 'tournaments',
  },
];

/**
 * The ways to play beyond joining a listed Room, in the order a visitor most
 * often wants them, the open ones first. One whose destination is not
 * launched links to its explainer, tagged, never to sample data.
 */
export const playOptionsFor = (
  config: Readonly<Record<DestinationSlug, boolean>>,
): readonly PlayOption[] =>
  choices
    .map(({ launch, ...choice }) => ({
      ...choice,
      href: launch
        ? destinationHref(launch, { path: choice.href, config })
        : choice.href,
      comingSoon: launch !== undefined && !config[launch],
    }))
    .sort((a, b) => Number(a.comingSoon) - Number(b.comingSoon));

/**
 * The Play dialog lists these over the Lobby, and `/play` lists the same
 * choices as a page when no script runs.
 */
export const playOptions: readonly PlayOption[] = playOptionsFor(launched);
