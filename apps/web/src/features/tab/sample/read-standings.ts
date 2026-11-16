import { sampleDivisionStandingsView, sampleStandingsView } from './standings';
import type { SampleScene } from './scene';
import {
  type StandingsTable,
  standingsTableOf,
  withDivisionBreak,
} from '../standings';

export const readStandings = (
  slug: string,
  event: string | null,
  scene: SampleScene,
): StandingsTable | null => {
  const sample = sampleStandingsView(slug, event, scene);
  if (sample === null) return null;
  const table = standingsTableOf(sample.read, sample.tiebreaks);
  const novice = sampleDivisionStandingsView(slug, event, 'Novice', scene);
  if (novice === null) return table;
  return withDivisionBreak(
    table,
    standingsTableOf(novice.read, novice.tiebreaks),
  );
};
