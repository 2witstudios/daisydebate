import { sampleAction } from '../action';
import type {
  Bracket,
  BracketSide,
  BracketTie,
  EventResults,
} from '../results';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY } from './moment';
import type { SampleScene } from './scene';

const side = (seed: number, name: string): BracketSide => ({ seed, name });

/** A decided fixture, by the ballots each side won. */
const decided = (
  top: BracketSide,
  topBallots: number,
  bottom: BracketSide,
  bottomBallots: number,
): BracketTie => ({
  top,
  bottom,
  result: { top: topBallots, bottom: bottomBallots },
  room: null,
  watch: null,
});

const live = (
  top: BracketSide,
  bottom: BracketSide,
  room: string,
): BracketTie => ({
  top,
  bottom,
  result: null,
  room,
  watch: sampleAction('Watch'),
});

export function sampleBracket(
  slug: string,
  event: string | null,
  scene: SampleScene,
): Bracket | null {
  if (slug !== AUTUMN || (event !== null && event !== VARSITY)) return null;
  if (!reached(scene, 'elims')) return null;
  const finished = reached(scene, 'finished');
  return {
    stages: [
      {
        name: 'Quarterfinals',
        state: 'done',
        time: null,
        ties: [
          decided(side(1, 'Jensen'), 3, side(8, 'Sato'), 0),
          decided(side(4, 'Amari'), 1, side(5, 'Doyle'), 2),
          decided(side(2, 'Castillo'), 3, side(7, 'Wu'), 0),
          decided(side(3, 'Okafor'), 2, side(6, 'Haddad'), 1),
        ],
        note: null,
      },
      {
        name: 'Semifinals',
        state: finished ? 'done' : 'live',
        time: null,
        ties: finished
          ? [
              decided(side(1, 'Jensen'), 2, side(5, 'Doyle'), 1),
              decided(side(2, 'Castillo'), 1, side(3, 'Okafor'), 2),
            ]
          : [
              live(side(1, 'Jensen'), side(5, 'Doyle'), 'Room 1'),
              live(side(2, 'Castillo'), side(3, 'Okafor'), 'Room 2'),
            ],
        note: null,
      },
      {
        name: 'Final',
        state: finished ? 'done' : 'upcoming',
        time: finished ? null : '18:30',
        ties: finished
          ? [decided(side(1, 'Jensen'), 4, side(3, 'Okafor'), 1)]
          : [],
        note: finished
          ? null
          : 'Created when both semifinals have three ballots in. Five judges.',
      },
    ],
  };
}

export function sampleEventResults(
  slug: string,
  scene: SampleScene,
): EventResults | null {
  const bracket = sampleBracket(slug, null, scene);
  if (bracket === null) return null;
  const finished = reached(scene, 'finished');
  return {
    lede: finished
      ? `${LEAGUE_NAME} has the results.`
      : 'Prelims certified at 16:52. Elimination rounds are still running.',
    certification: finished
      ? { kind: 'certified', at: '19:40' }
      : { kind: 'blocked', reason: 'The semifinals and the final still run.' },
    bracket,
    audiencesHeading: 'Who can see prelim ballots',
    audiences: [
      {
        audience: 'Tab staff',
        detail: 'Everything, as ballots arrive',
        open: null,
      },
      {
        audience: 'Coaches and parents',
        detail: "Their own entries' full ballots · opened as each round closed",
        open: null,
      },
      {
        audience: 'Competitors',
        detail: finished
          ? 'Scores and feedback opened when prelims were certified.'
          : 'Win or loss is open. Scores and feedback open now that prelims are certified. 2 ballots are held for review.',
        open: finished ? null : sampleAction('Open to competitors', true),
      },
      {
        audience: 'Public',
        detail: 'Results only · opened when the break was announced',
        open: null,
      },
    ],
    checks: [
      {
        kind: 'held_ballots',
        title: '2 ballots held by screening',
        detail:
          "A phone number was removed from one. One is flagged for language. The judge's original is kept.",
        action: sampleAction('Review held ballots'),
      },
      {
        kind: 'correction',
        title: '1 correction since certifying prelims',
        detail:
          "Round 2, Reid v Nakata: winner corrected by D. Abara, confirmed by you. Round 3's draw used the old result and stands as published. Standings changed from that point.",
        action: null,
      },
      {
        kind: 'sanction',
        title: `${LEAGUE_NAME} receives results`,
        detail: finished
          ? 'Sent when you certified the event.'
          : 'Sent when you certify the event.',
        action: null,
      },
    ],
  };
}
