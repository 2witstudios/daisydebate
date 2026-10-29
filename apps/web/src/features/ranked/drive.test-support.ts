import {
  sampleStanding,
  sampleOpponent,
  sampleMatchTimings,
  sampleRankedFacts,
} from './samples.test-support';
import { screenFor } from './drive-match';
import { hostScreenFor } from './drive-host';
export const driveMatch = (query: Parameters<typeof screenFor>[0]) =>
  screenFor(query, {
    standing: sampleStanding,
    opponent: sampleOpponent,
    timings: sampleMatchTimings,
    facts: sampleRankedFacts,
  });
export const driveHost = (query: Parameters<typeof hostScreenFor>[0]) =>
  hostScreenFor(query, sampleStanding);
