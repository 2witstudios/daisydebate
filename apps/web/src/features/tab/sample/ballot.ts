import type {
  EventBallotView,
  JudgeBallotView,
} from '@daisy/protocol/lobby/ballot-read';
import type { BallotDefinition } from '../ballot-definition';
import { AUTUMN, LEAGUE_NAME, reached, VARSITY } from './moment';
import { own } from './own';
import type { SampleScene } from './scene';

/** A sample record's id: its name, as a 24-character cuid2-shaped id. */
const sampleId = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

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

export function sampleEventBallot(
  slug: string,
  event: string,
  scene: SampleScene,
): EventBallotView | null {
  if (slug !== AUTUMN || event !== VARSITY) return null;
  return {
    lobbyId: sampleId('autumnopen'),
    eventId: sampleId('eventvarsity'),
    definition: varsity,
    pin: {
      kind: 'template',
      templateId: sampleId('templatesoutheast'),
      organizationName: LEAGUE_NAME,
    },
    usedIn: reached(scene, 'prelims') ? { first: 1, last: 3 } : null,
    screening: 'hold',
    capabilities: { setScreening: true },
  };
}

const debaters = (affirmative: string, negative: string) =>
  [
    { key: affirmative.toLowerCase(), name: affirmative, role: 'Affirmative' },
    { key: negative.toLowerCase(), name: negative, role: 'Negative' },
  ] as const;

/** Both debaters and their coaches read the reason. */
const reasonAudiences = ['responsible_adults', 'competitors'] as const;

const ballots: Readonly<Record<string, JudgeBallotView>> = {
  'semifinal-room-1': {
    fixtureId: sampleId('fixturesemifinalroom1'),
    tournamentName: 'Autumn Open',
    eventName: null,
    tabRoundName: 'Semifinal',
    placeName: 'Room 1',
    panel: { size: 3, position: 1, chair: false },
    resolution: {
      kind: 'released',
      text: 'Cities should charge drivers to enter the centre.',
    },
    definition: elimination,
    subjectKind: 'debater',
    subjects: [...debaters('Jensen', 'Doyle')],
    draft: {
      winner: 'jensen',
      points: { jensen: 28.5, doyle: 29 },
      reason:
        "Jensen carried the cost argument; Doyle's congestion data went unanswered until the last speech.",
    },
    reasonAudiences: [...reasonAudiences],
  },
  'round-4-room-5': {
    fixtureId: sampleId('fixtureround4room5'),
    tournamentName: 'Autumn Open',
    eventName: null,
    tabRoundName: 'Round 4',
    placeName: 'Room 5',
    panel: { size: 1, position: 1, chair: true },
    resolution: { kind: 'not_released' },
    definition: varsity,
    subjectKind: 'debater',
    subjects: [...debaters('Sato', 'Doyle')],
    draft: { winner: null, points: { sato: 27, doyle: 27 }, reason: '' },
    reasonAudiences: [...reasonAudiences],
  },
  'impromptu-section-c': {
    fixtureId: sampleId('fixtureimpromptusectionc'),
    tournamentName: 'Winter Classic',
    eventName: 'Impromptu',
    tabRoundName: 'Round 1',
    placeName: 'Section C',
    panel: { size: 2, position: 1, chair: false },
    resolution: { kind: 'not_released' },
    definition: speech,
    subjectKind: 'speaker',
    subjects: [
      { key: 'ruiz', name: 'Tomas Ruiz', role: 'Lakeside' },
      { key: 'kim', name: 'Hana Kim', role: 'Hartwell' },
      { key: 'nair', name: 'Priya Nair', role: 'Ridgeview' },
      { key: 'okafor', name: 'Ada Okafor', role: 'Okafor family' },
      { key: 'wu', name: 'Wu', role: 'Hartwell' },
      { key: 'brandt', name: 'Leo Brandt', role: 'Hartwell' },
    ],
    draft: { winner: null, points: {}, reason: '' },
    reasonAudiences: [...reasonAudiences],
  },
  'championship-round-2-room-4': {
    fixtureId: sampleId('fixturechampionshipr2r4'),
    tournamentName: 'Championship',
    eventName: null,
    tabRoundName: 'Round 2',
    placeName: 'Room 4',
    panel: { size: 3, position: 1, chair: true },
    resolution: {
      kind: 'released',
      text: 'This house would make public transport free.',
    },
    definition: fourSides,
    subjectKind: 'team',
    subjects: [
      { key: 'og', name: 'Hartwell A', role: 'Opening Government' },
      { key: 'oo', name: 'Ridgeview B', role: 'Opening Opposition' },
      { key: 'cg', name: 'Lakeside A', role: 'Closing Government' },
      { key: 'co', name: 'Ridgeview C', role: 'Closing Opposition' },
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
    reasonAudiences: [...reasonAudiences],
  },
};

/** A ballot answers for the judge of its Room and for nobody else. */
export const sampleJudgeBallot = (
  room: string,
  scene: SampleScene,
): JudgeBallotView | null =>
  scene.viewer === 'judge' ? own(ballots, room) : null;
