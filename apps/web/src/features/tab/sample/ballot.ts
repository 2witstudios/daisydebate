import { linkTo } from '../action';
import type {
  BallotDefinition,
  BallotSettings,
  JudgeBallot,
} from '../ballot-definition';
import { hostRoutes } from '../routes';
import { lockedSetting, type ResolvedSetting } from '../settings';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY, varsitySwitch } from './moment';
import { own } from './own';
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

const locked = (
  key: string,
  label: string,
  value: string,
): ResolvedSetting => ({
  keys: [key],
  label,
  value,
  source: { scope: 'organization', name: LEAGUE_NAME },
  control: lockedSetting,
  attention: null,
});

const written = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'off', label: 'Off' },
];

export function sampleBallotSettings(
  slug: string,
  event: string,
  scene: SampleScene,
): BallotSettings | null {
  if (slug !== AUTUMN || event !== VARSITY) return null;
  return {
    event: varsitySwitch,
    setup: linkTo('Setup', hostRoutes.setup(AUTUMN)),
    lede: reached(scene, 'prelims')
      ? 'Version 2, used in rounds 1 to 3. A change starts with the next draw you publish.'
      : 'Version 2. A change starts with the next draw you publish.',
    saveLabel: 'Save as version 3',
    locked: [
      locked('ballot.points.scale', 'Point scale', '20 to 30'),
      locked('ballot.points.step', 'Step', 'Halves'),
      locked(
        'ballot.points.low_point_win',
        'Winner may have fewer points',
        'No',
      ),
    ],
    sections: [
      {
        heading: 'Points',
        options: [
          {
            id: 'ranks',
            label: 'Ranks',
            detail: 'Judges rank the speakers in the room',
            options: [
              { value: 'off', label: 'Off' },
              { value: 'on', label: '1st to last' },
            ],
            value: 'off',
          },
          {
            id: 'criteria',
            label: 'Criteria',
            detail: 'Scored separately and added up',
            options: [
              { value: 'none', label: 'None, one score each' },
              { value: 'grid', label: 'Argument, evidence, delivery' },
            ],
            value: 'none',
          },
        ],
      },
      {
        heading: 'Outcomes',
        options: [
          {
            id: 'doubleLoss',
            label: 'Double loss',
            detail: 'A judge may give the win to neither side',
            options: [
              { value: 'prelims', label: 'Prelims only' },
              { value: 'never', label: 'Never' },
              { value: 'any', label: 'Any round' },
            ],
            value: 'prelims',
          },
        ],
      },
      {
        heading: 'Written',
        options: [
          {
            id: 'reason',
            label: 'Reason for decision',
            detail: 'Read by both debaters and their coaches',
            options: written,
            value: 'required',
          },
          {
            id: 'feedback',
            label: 'Feedback to each debater',
            detail: 'Read by that debater and their coach',
            options: written,
            value: 'optional',
          },
          {
            id: 'privateNote',
            label: 'Private note to tab',
            detail: 'Never released',
            options: written.filter((option) => option.value !== 'required'),
            value: 'optional',
          },
        ],
      },
      {
        heading: 'Screening',
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
