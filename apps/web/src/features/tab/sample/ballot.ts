import { linkTo } from '../action';
import type {
  BallotDefinition,
  BallotSettings,
  JudgeBallot,
} from '../ballot-definition';
import { hostRoutes } from '../routes';
import { lockedSetting, type ResolvedSetting } from '../settings';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY } from './moment';
import { own } from './own';
import { varsitySwitch } from './event-switch';
import type { SampleScene } from './scene';

const varsity: BallotDefinition = {
  version: 2,
  points: { min: 20, max: 30, step: 0.5, lowPointWin: false },
  ranks: false,
  criteria: [],
  outcomes: { winner: true, doubleLoss: true },
  written: {
    reason: 'required',
    feedback: 'optional',
    privateNote: 'optional',
  },
};

const elimination: BallotDefinition = {
  ...varsity,
  outcomes: { winner: true, doubleLoss: false },
  written: { reason: 'required', feedback: 'off', privateNote: 'optional' },
};

const speech: BallotDefinition = {
  version: 1,
  points: null,
  ranks: true,
  criteria: [],
  outcomes: { winner: false, doubleLoss: false },
  written: { reason: 'off', feedback: 'required', privateNote: 'optional' },
};

const fourSides: BallotDefinition = {
  version: 1,
  points: { min: 50, max: 100, step: 1, lowPointWin: true },
  ranks: true,
  criteria: ['Argument', 'Evidence', 'Delivery'],
  outcomes: { winner: false, doubleLoss: false },
  written: { reason: 'required', feedback: 'optional', privateNote: 'off' },
};

/** One part of the ballot definition the league's template pins. */
const pinned = (label: string, value: string): ResolvedSetting => ({
  keys: ['ballot.definition'],
  label,
  value,
  source: { scope: 'organization', name: LEAGUE_NAME },
  control: lockedSetting,
  attention: null,
});

export function sampleBallotSettings(
  slug: string,
  event: string,
  scene: SampleScene,
): BallotSettings | null {
  if (slug !== AUTUMN || event !== VARSITY) return null;
  return {
    event: varsitySwitch(scene),
    setup: linkTo('Setup', hostRoutes.setup(AUTUMN)),
    lede: reached(scene, 'prelims')
      ? `Version 2, used in rounds 1 to 3 · pinned by ${LEAGUE_NAME}'s template`
      : `Version 2 · pinned by ${LEAGUE_NAME}'s template`,
    saveLabel: 'Save screening',
    sections: [
      {
        heading: 'Points',
        locked: [
          pinned('Point scale', '20 to 30'),
          pinned('Step', 'Halves'),
          pinned('Winner may have fewer points', 'No'),
          pinned('Ranks', 'Off'),
          pinned('Criteria', 'None, one score each'),
        ],
        options: [],
      },
      {
        heading: 'Outcomes',
        locked: [pinned('Double loss', 'Prelims only')],
        options: [],
      },
      {
        heading: 'Written',
        locked: [
          pinned('Reason for decision', 'Required'),
          pinned('Feedback to each debater', 'Optional'),
          pinned('Private note to tab', 'Optional'),
        ],
        options: [],
      },
      {
        heading: 'Screening',
        locked: [],
        options: [
          {
            id: 'screening',
            label: 'Written text',
            detail:
              "Phone numbers, links and flagged language. The judge's original is kept.",
            options: [
              { value: 'hold', label: 'Hold for your review' },
              { value: 'release', label: 'Release unscreened' },
            ],
            value: 'hold',
          },
        ],
      },
    ],
    definition: varsity,
    preview: {
      lede: 'A prelim round, with sample names',
      subjects: [
        { id: 'jensen', name: 'Jensen', role: 'Affirmative' },
        { id: 'doyle', name: 'Doyle', role: 'Negative' },
      ],
      draft: {
        winner: 'jensen',
        points: { jensen: 28.5, doyle: 27 },
        reason: '',
      },
    },
  };
}

const ballots: Readonly<Record<string, JudgeBallot>> = {
  'semifinal-room-1': {
    context: 'Autumn Open · Semifinal · Room 1 · 1 of 3 judges',
    resolution: 'Cities should charge drivers to enter the centre.',
    definition: elimination,
    subjects: [
      { id: 'jensen', name: 'Jensen', role: 'Affirmative' },
      { id: 'doyle', name: 'Doyle', role: 'Negative' },
    ],
    draft: {
      winner: 'jensen',
      points: { jensen: 28.5, doyle: 29 },
      reason:
        "Jensen carried the cost argument; Doyle's congestion data went unanswered until the last speech.",
    },
    reasonReaders: 'Both debaters and their coaches read this.',
  },
  'round-4-room-5': {
    context: 'Autumn Open · Round 4 · Room 5 · the only judge',
    resolution: null,
    definition: varsity,
    subjects: [
      { id: 'sato', name: 'Sato', role: 'Affirmative' },
      { id: 'doyle', name: 'Doyle', role: 'Negative' },
    ],
    draft: { winner: null, points: { sato: 27, doyle: 27 }, reason: '' },
    reasonReaders: 'Both debaters and their coaches read this.',
  },
  'impromptu-section-c': {
    context: 'Winter Classic · Impromptu · Round 1 · Section C · 1 of 2 judges',
    resolution: null,
    definition: speech,
    subjects: [
      { id: 'ruiz', name: 'Tomas Ruiz', role: 'Lakeside' },
      { id: 'kim', name: 'Hana Kim', role: 'Hartwell' },
      { id: 'nair', name: 'Priya Nair', role: 'Ridgeview' },
      { id: 'okafor', name: 'Ada Okafor', role: 'Okafor family' },
      { id: 'wu', name: 'Wu', role: 'Hartwell' },
      { id: 'brandt', name: 'Leo Brandt', role: 'Hartwell' },
    ],
    draft: { winner: null, points: {}, reason: '' },
    reasonReaders: 'Each speaker and their coach read this.',
  },
  'championship-round-2-room-4': {
    context: 'Championship · Round 2 · Room 4 · you chair 3 judges',
    resolution: 'This house would make public transport free.',
    definition: fourSides,
    subjects: [
      { id: 'og', name: 'Hartwell A', role: 'Opening Government' },
      { id: 'oo', name: 'Ridgeview B', role: 'Opening Opposition' },
      { id: 'cg', name: 'Lakeside A', role: 'Closing Government' },
      { id: 'co', name: 'Ridgeview C', role: 'Closing Opposition' },
    ],
    draft: {
      winner: null,
      points: Object.fromEntries(
        (['og', 'oo', 'cg', 'co'] as const).flatMap((team, index) =>
          fourSides.criteria.map((criterion) => [
            `${team}:${criterion}`,
            76 - index * 2,
          ]),
        ),
      ),
      reason: '',
    },
    reasonReaders: 'All four teams and their coaches read this.',
  },
};

/** A ballot answers for the judge of its Room and for nobody else. */
export const sampleJudgeBallot = (
  room: string,
  scene: SampleScene,
): JudgeBallot | null => (scene.viewer === 'judge' ? own(ballots, room) : null);

export const sampleBallotRooms = Object.keys(ballots);
