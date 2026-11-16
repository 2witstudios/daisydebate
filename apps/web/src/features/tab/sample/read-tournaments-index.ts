import { samplePlaces } from './tournament-catalogue';
import { sampleAddressOf, sampleTournamentListRead } from './tournament';
import type { SampleScene } from './scene';
import {
  type IndexParams,
  type TournamentsIndex,
  indexStateOf,
  tournamentsIndexOf,
} from '../tournaments-index';

export const readTournamentsIndex = (
  scene: SampleScene,
  params: IndexParams = {},
): TournamentsIndex =>
  tournamentsIndexOf(
    sampleTournamentListRead(scene),
    indexStateOf(params, samplePlaces),
    sampleAddressOf,
    samplePlaces,
  );
