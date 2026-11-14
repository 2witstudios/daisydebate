import { sampleAction } from '../action';
import type { ResolvedSetting } from '../settings';
import type { StandingRow, StandingsTable } from '../standings';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY } from './moment';
import type { SampleScene } from './scene';

const row = (
  seed: number,
  entry: string,
  school: string,
  wins: number,
  points: number,
  opponentWins: number,
  rating: number | null,
  reason: string,
  decisive = false,
): StandingRow => ({
  seed,
  entry,
  school,
  wins,
  points,
  opponentWins,
  rating,
  reason,
  decisive,
});

export const tiebreaks: ResolvedSetting = {
  keys: ['standings.tiebreaks'],
  label: 'Tiebreaks',
  value: "Wins, speaker points, opponents' wins, rating",
  source: { scope: 'organization', name: LEAGUE_NAME },
  hold: 'enforced',
  locked: true,
  attention: null,
  edit: null,
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

export function sampleStandings(
  slug: string,
  event: string | null,
  scene: SampleScene,
): StandingsTable | null {
  if (slug !== AUTUMN || (event !== null && event !== VARSITY)) return null;
  if (!reached(scene, 'prelims')) return null;
  const done = reached(scene, 'break');
  const host = scene.viewer === 'host';
  return {
    title: done ? 'Standings after round 4' : 'Standings after round 2',
    lede: done
      ? 'Top 8 break to quarterfinals. All 96 ballots are in.'
      : 'Top 8 break to quarterfinals. Round 3 is still running.',
    tiebreaks,
    tiebreakOrder: [
      'wins',
      'speaker points',
      "opponents' wins",
      'rating at the start',
    ],
    rows,
    breakAfter: 8,
    remaining: 14,
    announce:
      host && done && !reached(scene, 'elims')
        ? sampleAction('Announce the break', true)
        : null,
    correction: host
      ? sampleAction('See what a correction would change')
      : null,
  };
}
