import { stepHref, type MatchStep } from './ranked-query';

/**
 * The mock matchmaking flow (ADR 0049 section 6: an accepted offer creates a
 * room with both seats filled). Every screen is one URL step; this table says
 * where each step goes next and how long the mock waits before going there.
 * The backend replaces the waiting with real events, and `driveMatch` with
 * the server's state, without the screens changing.
 */

/** The opponent as a match offer shows them. */
export type MatchOpponent = {
  readonly handle: string;
  readonly rating: number;
  readonly status: 'provisional' | 'established';
};

/** Seconds each step lasts before the mock moves on (sample values). */
export type MatchTimings = {
  readonly searchSeconds: number;
  /** Time to answer an offer, and the countdown both players see. */
  readonly respondSeconds: number;
  readonly waitingSeconds: number;
  readonly readySeconds: number;
  readonly enterSeconds: number;
};

/** A move to another URL once `afterSeconds` have passed. */
export type Advance = {
  readonly afterSeconds: number;
  readonly href: string;
};

/**
 * Where a step goes by itself. The offer times out to the neutral ended
 * state, and entering leaves for `roomHref`. The ended step is final.
 */
export function advanceFrom(
  step: MatchStep,
  timings: MatchTimings,
  roomHref: string,
): Advance | null {
  switch (step) {
    case 'search':
      return { afterSeconds: timings.searchSeconds, href: stepHref('offer') };
    case 'offer':
      return { afterSeconds: timings.respondSeconds, href: stepHref('ended') };
    case 'waiting':
      return { afterSeconds: timings.waitingSeconds, href: stepHref('ready') };
    case 'ready':
      return { afterSeconds: timings.readySeconds, href: stepHref('entering') };
    case 'entering':
      return { afterSeconds: timings.enterSeconds, href: roomHref };
    case 'ended':
      return null;
  }
}
