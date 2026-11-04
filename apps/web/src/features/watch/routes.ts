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

/**
 * A Room link, which a visitor may follow to Watch once the Round's start is
 * released: its page decides, so the proxy sends no sign-in hint ahead of it.
 */
export const roomLinkReachesWatch = (pathname: string): boolean =>
  /^\/rooms\/[^/]+$/.test(pathname);

/** Where a Room's link sends someone outside it; null until the start is released. */
export const roomWatchHref = (roundId: string | null): string | null =>
  roundId === null ? null : liveHref(roundId);

/** The replay of a recorded Round, optionally with its query. */
export const replayHref = (id: string, search = ''): string =>
  `${watchRoutes.recordings}/${segment(id)}${search === '' ? '' : `?${search}`}`;
