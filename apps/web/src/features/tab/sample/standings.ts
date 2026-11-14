import type { StandingsView } from '@daisy/protocol/lobby/standings-read';
import { lockedSetting, type ResolvedSetting } from '../settings';
import { standingsTableOf, type StandingsTable } from '../standings';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY } from './moment';
import type { SampleScene } from './scene';
import { sampleId } from './tab-round';

type Row = Extract<StandingsView, { visibility: 'official' }>['rows'][number];

const row = (
  seed: number,
  entry: string,
  school: string,
  wins: number,
  points: number,
  opponentWins: number,
  rating: number | null,
  explanation: string,
  decidesBreak = false,
): Row => ({
  seed,
  entry: { entryId: sampleId(`entry${entry}`), name: entry },
  responsible: {
    kind: school.endsWith(' family') ? 'guardian' : 'school',
    name: school,
  },
  wins,
  points,
  opponentWins,
  rating,
  explanation,
  decidesBreak,
});

export const tiebreaks: ResolvedSetting = {
  keys: ['standings.tiebreaks'],
  label: 'Tiebreaks',
  value: "Wins, speaker points, opponents' wins, rating",
  source: { scope: 'organization', name: LEAGUE_NAME },
  control: lockedSetting,
  attention: null,
};

const rows = [
  row(
    1,
    'Jensen',
    'Hartwell',
    4,
    114.5,
    9,
    1712,
    'Only entry on 4 wins with 114.5',
  ),
  row(
    2,
    'Castillo',
    'Ridgeview',
    4,
    113,
    10,
    1655,
    'Behind Jensen on speaker points',
  ),
  row(
    3,
    'Okafor',
    'Okafor family',
    3,
    113.5,
    9,
    1590,
    'Most speaker points on 3 wins',
  ),
  row(
    4,
    'Amari',
    'Lakeside',
    3,
    112,
    10,
    1641,
    'Behind Okafor on speaker points',
  ),
  row(
    5,
    'Doyle',
    'Ridgeview',
    3,
    111.5,
    8,
    1604,
    'Behind Amari on speaker points',
  ),
  row(
    6,
    'Haddad',
    'Hartwell',
    3,
    110,
    9,
    1570,
    "Tied with Wu on points; ahead on opponents' wins",
  ),
  row(7, 'Wu', 'Lakeside', 3, 110, 8, 1622, "Behind Haddad on opponents' wins"),
  row(
    8,
    'Sato',
    'Ridgeview',
    2,
    112.5,
    9,
    1548,
    'Tied with Brooks on everything else; ahead on rating',
    true,
  ),
  row(
    9,
    'Brooks',
    'Hartwell',
    2,
    112.5,
    9,
    1531,
    'Behind Sato on rating, 1531 to 1548',
  ),
  row(
    10,
    'Petrov',
    'Lakeside',
    2,
    111,
    8,
    null,
    'Behind Brooks on speaker points',
  ),
];

/**
 * Varsity debate's table once prelims run. The host reads it as an official;
 * everyone else as an audience to whom decisions and scores are released.
 */
export function sampleStandingsView(
  slug: string,
  event: string | null,
  scene: SampleScene,
): { readonly read: StandingsView; readonly tiebreaks: ResolvedSetting } | null {
  if (slug !== AUTUMN || (event !== null && event !== VARSITY)) return null;
  if (!reached(scene, 'prelims')) return null;
  const done = reached(scene, 'break');
  const shape = {
    lobbyId: sampleId('autumnopen'),
    eventId: sampleId('eventvarsity'),
    division: null,
    throughRound: done ? 4 : 2,
    progress: done
      ? { kind: 'complete' as const, ballots: 96 }
      : { kind: 'running' as const, tabRoundNumber: 3 },
    tiebreaks: ['wins', 'total_points', 'opponent_wins', 'rating'] as const,
    breakLine: { seeds: 8, tabRoundName: 'Quarterfinals' },
    breakAnnouncedAt: reached(scene, 'elims') ? '2026-10-17T17:05:00.000Z' : null,
    entryCount: 24,
    rows,
  };
  return {
    read:
      scene.viewer === 'host'
        ? {
            ...shape,
            tiebreaks: [...shape.tiebreaks],
            visibility: 'official',
            capabilities: { announceBreak: true, previewCorrection: true },
          }
        : {
            ...shape,
            tiebreaks: [...shape.tiebreaks],
            visibility: 'released_with_scores',
          },
    tiebreaks,
  };
}

/** The table as a screen draws it, for the sample screens that embed one. */
export function sampleStandings(
  slug: string,
  event: string | null,
  scene: SampleScene,
): StandingsTable | null {
  const sample = sampleStandingsView(slug, event, scene);
  return sample === null ? null : standingsTableOf(sample.read, sample.tiebreaks);
}
