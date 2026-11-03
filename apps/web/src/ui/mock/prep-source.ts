import type { PrepSource } from '../../features/prep/source';
import { sampleLibrary, sampleSavedSearches } from './prep';
import {
  emptyBrief,
  sampleBriefs,
  sampleSpeechLimitSeconds,
} from './prep-briefs';
import {
  defaultPassage,
  layered,
  sampleCards,
  sampleReadingPace,
} from './prep-cards';
import { sampleCases } from './prep-cases';
import { sampleShares, sampleTeams, strangerTeamNames } from './prep-teams';

/** Sample data for every Prep page, handed in at the page. */
export const samplePrepSource: PrepSource = {
  library: sampleLibrary,
  savedSearches: sampleSavedSearches,
  cards: sampleCards,
  draftSegments: layered(defaultPassage),
  readingPace: sampleReadingPace,
  cases: sampleCases,
  briefs: sampleBriefs,
  emptyBrief,
  speechLimitSeconds: sampleSpeechLimitSeconds,
  teams: sampleTeams,
  shares: sampleShares,
  strangerTeamNames,
};
