import {
  sampleMatchTimings,
  sampleOpponent,
  sampleRankedFacts,
  sampleStanding,
} from '../../ui/mock/ranked';
import { rankedDestinations } from './actions';
import {
  advanceFrom,
  type Advance,
  type MatchOpponent,
  type MatchTimings,
} from './match-flow';
import { rankedHref, stepHref, type RankedQuery } from './ranked-query';
import { rankedRules, type RankedFacts, type RankedRule } from './rules';
import type { RankedStanding } from './standing';

export type HubScreen = {
  readonly step: 'hub';
  readonly standing: RankedStanding;
  readonly rules: readonly RankedRule[];
  readonly rulesOpen: boolean;
  readonly findMatchHref: string;
  readonly openRulesHref: string;
  readonly closeRulesHref: string;
  readonly hostHref: string;
};

export type SearchScreen = {
  readonly step: 'search';
  readonly cancelHref: string;
  readonly advance: Advance;
};

export type OfferScreen = {
  readonly step: 'offer';
  readonly opponent: MatchOpponent;
  readonly respondSeconds: number;
  readonly acceptHref: string;
  readonly declineHref: string;
  readonly advance: Advance;
};

export type WaitingScreen = {
  readonly step: 'waiting';
  readonly opponent: MatchOpponent;
  readonly respondSeconds: number;
  readonly advance: Advance;
};

export type ReadyScreen = {
  readonly step: 'ready';
  readonly opponent: MatchOpponent;
  readonly advance: Advance;
};

export type EnteringScreen = {
  readonly step: 'entering';
  readonly opponent: MatchOpponent;
  readonly enterHref: string;
  readonly advance: Advance;
};

export type EndedScreen = {
  readonly step: 'ended';
  readonly restartHref: string;
  readonly backHref: string;
};

/** What the Ranked page renders: one screen per URL step. */
export type RankedScreen =
  | HubScreen
  | SearchScreen
  | OfferScreen
  | WaitingScreen
  | ReadyScreen
  | EnteringScreen
  | EndedScreen;

export type Sources = {
  readonly standing: RankedStanding;
  readonly opponent: MatchOpponent;
  readonly timings: MatchTimings;
  readonly facts: RankedFacts;
};

/**
 * Pure: the screen for a step from already-loaded sources. A real advance
 * (an event, not a timer) replaces `advanceFrom`, not this mapping.
 */
export function screenFor(
  { step, rules }: RankedQuery,
  { standing, opponent, timings, facts }: Sources,
): RankedScreen {
  const room = rankedDestinations.room;
  const respondSeconds = timings.respondSeconds;
  if (step === 'hub')
    return {
      step,
      standing,
      rules: rankedRules(facts),
      rulesOpen: rules,
      findMatchHref: stepHref('search'),
      openRulesHref: rankedHref({ step: 'hub', rules: true }),
      closeRulesHref: rankedHref({ step: 'hub', rules: false }),
      hostHref: rankedDestinations.hostTable,
    };
  if (step === 'ended')
    return {
      step,
      restartHref: stepHref('search'),
      backHref: rankedDestinations.ranked,
    };
  // The remaining steps always advance; the type says so.
  const advance = advanceFrom(step, timings, room) as Advance;
  switch (step) {
    case 'search':
      return { step, cancelHref: rankedDestinations.ranked, advance };
    case 'offer':
      return {
        step,
        opponent,
        respondSeconds,
        acceptHref: stepHref('waiting'),
        declineHref: stepHref('ended'),
        advance,
      };
    case 'waiting':
      return { step, opponent, respondSeconds, advance };
    case 'ready':
      return { step, opponent, advance };
    case 'entering':
      return { step, opponent, enterHref: room, advance };
  }
}

/**
 * The Ranked page's one data seam (matchmaking, MTCH-1.1 onward). Today it
 * plays the sample flow from the URL step; the server's matchmaking state
 * replaces this function and nothing else.
 */
export function driveMatch(query: RankedQuery): RankedScreen {
  return screenFor(query, {
    standing: sampleStanding,
    opponent: sampleOpponent,
    timings: sampleMatchTimings,
    facts: sampleRankedFacts,
  });
}
