import { sampleTimelineRead } from './rail';
import { sampleAddressOf, sampleTournamentReads } from './tournament';
import type { SampleScene } from './scene';
import {
  type TimelineRail,
  type TournamentPage,
  type TournamentView,
  timelineRailOf,
  tournamentPageOf,
} from '../../tournament';

export const readTimelineRail = (
  slug: string,
  scene: SampleScene,
): TimelineRail | null => {
  const lobby = sampleTimelineRead(slug, scene);
  return lobby === null ? null : timelineRailOf(lobby, sampleAddressOf);
};

export const readTournamentPage = (
  slug: string,
  view: TournamentView,
  scene: SampleScene,
): TournamentPage | null => {
  const reads = sampleTournamentReads(slug, view, scene);
  return reads === null ? null : tournamentPageOf(reads, view, sampleAddressOf);
};
