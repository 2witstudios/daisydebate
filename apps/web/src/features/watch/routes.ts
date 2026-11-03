/**
 * Where Watch lives. The live hub, the live view, the recordings archive and
 * replay are all public (spectator routes stay outside the guarded areas), and
 * each Round's visibility decides who may open it. Moving a screen is a change to
 * this module and to its route file, nothing else.
 */
export const watchRoutes = {
  hub: '/watch',
  recordings: '/recordings',
  lobby: '/lobby',
  findMatch: '/ranked',
} as const;

const segment = (id: string): string => encodeURIComponent(id);

/** The Broadcast of a Round. */
export const liveHref = (id: string): string =>
  `${watchRoutes.hub}/${segment(id)}`;

/** The replay of a recorded Round, optionally with its query. */
export const replayHref = (id: string, search = ''): string =>
  `${watchRoutes.recordings}/${segment(id)}${search === '' ? '' : `?${search}`}`;
