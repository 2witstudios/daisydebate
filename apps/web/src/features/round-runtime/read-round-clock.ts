import { serverInstantOf } from './server-clock-header';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type RoundClockRead = {
  readonly kind: 'found' | 'missing' | 'unavailable';
  readonly serverNowMs: number | null;
};

/**
 * Reads the server instant from an authorized Round read in the browser, not
 * through a Server Action: those run one at a time, so an unrelated stuck
 * action would hold calibration and queueing would inflate the measured RTT.
 * The instant is in the headers, so the body is not needed.
 */
export async function readRoundClock(
  fetch: FetchLike,
  url: string,
  signal?: AbortSignal,
): Promise<RoundClockRead> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      ...(signal ? { signal } : {}),
    });
    await response.body?.cancel();
    if (response.status === 404) return { kind: 'missing', serverNowMs: null };
    if (!response.ok) return { kind: 'unavailable', serverNowMs: null };
    return {
      kind: 'found',
      serverNowMs: serverInstantOf(response.headers),
    };
  } catch {
    return { kind: 'unavailable', serverNowMs: null };
  }
}
