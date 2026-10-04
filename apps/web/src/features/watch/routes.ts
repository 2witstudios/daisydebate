import { signInHref } from '../access/decision';

/**
 * Where Watch lives. The live hub and the live view are public (spectator
 * routes stay outside the guarded areas); the recordings archive and replay
 * sit under the guarded `/recordings` root. Moving a screen is a change to
 * this module and to its route file, nothing else.
 */
export const watchRoutes = {
  hub: '/watch',
  recordings: '/recordings',
  /** Where a seated debater goes to return to their own debate. */
  yourDebate: '/rooms/started',
  lobby: '/lobby',
  findMatch: '/ranked',
} as const;

const segment = (id: string): string => encodeURIComponent(id);

/** The live view of a debate, optionally with its query (pane, report). */
export const liveHref = (id: string, search = ''): string =>
  `${watchRoutes.hub}/${segment(id)}${search === '' ? '' : `?${search}`}`;

/** The replay of a recorded debate, optionally with its query. */
export const replayHref = (id: string, search = ''): string =>
  `${watchRoutes.recordings}/${segment(id)}${search === '' ? '' : `?${search}`}`;

/** Sign in, then come back to the debate being watched. */
export const signInToWatchHref = (id: string): string =>
  signInHref(liveHref(id));
