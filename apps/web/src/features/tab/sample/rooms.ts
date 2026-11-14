import { linkTo, sampleAction } from '../action';
import type { LiveSection, RoomSeat, WaitingRoom } from '../room';
import { tabRoutes } from '../routes';
import { AUTUMN, CHAMPIONSHIP } from './moment';
import type { SampleScene } from './scene';

const seat = (
  mark: string,
  tone: RoomSeat['tone'],
  name: string,
  role: string,
  status: string | null,
  members: string | null = null,
): RoomSeat => ({
  mark,
  tone,
  name,
  members,
  role,
  status,
  here: status === 'Here' || status === 'Ready',
  action: null,
});

const check = sampleAction('Check camera and microphone', true);
const tab = sampleAction('Message tab');

function rooms(scene: SampleScene): Readonly<Record<string, WaitingRoom>> {
  const judging = scene.viewer === 'judge';
  const you = (name: string) => (scene.viewer === 'competitor' ? 'You' : name);
  return {
    'semifinal-room-1': {
      arrangement: 'panel',
      back: { label: 'Autumn Open', href: tabRoutes.tournament(AUTUMN) },
      title: 'Semifinal · Room 1',
      lede: 'Opens in 6 minutes',
      seats: [
        seat('J', 'sky', 'Jensen', 'Affirmative · seed 1', 'Here'),
        seat('Y', 'clay', you('Doyle'), 'Negative · seed 5', 'Here'),
        seat(
          '3',
          'teal',
          'Three judges',
          'L. Malik, P. Nguyen here · A. Costa not yet',
          null,
        ),
      ],
      primary: judging
        ? linkTo('Open your ballot', tabRoutes.ballot('semifinal-room-1'), true)
        : check,
      primaryNote: null,
      pinned: {
        setBy: 'Autumn Open',
        lines: [
          { label: 'Format', value: 'One-on-one, limited prep · 26 min' },
          {
            label: 'Resolution',
            value:
              'Five appear when the room opens. You and Jensen strike in turn, then 20 minutes to prepare.',
          },
          { label: 'Decision', value: 'Two of three judges' },
          {
            label: 'Ballots',
            value:
              'Your coach sees them tonight. You see scores and feedback after the final.',
          },
          { label: 'Recording', value: 'Recorded and released to you' },
        ],
      },
      runOfShow: null,
      help: {
        text: 'Seats are assigned by the tournament.',
        action: sampleAction('Something wrong? Message tab'),
      },
    },
    'round-4-room-5': {
      arrangement: 'panel',
      back: { label: 'Autumn Open', href: tabRoutes.tournament(AUTUMN) },
      title: 'Round 4 · Room 5',
      lede: 'Opens 15:20',
      seats: [
        seat('S', 'sky', 'Sato', 'Affirmative', 'Not yet'),
        seat('Y', 'clay', you('Doyle'), 'Negative', 'Here'),
        seat('1', 'teal', 'One judge', judging ? 'You' : 'R. Keane', null),
      ],
      primary: judging
        ? linkTo('Open your ballot', tabRoutes.ballot('round-4-room-5'), true)
        : check,
      primaryNote: null,
      pinned: {
        setBy: 'Autumn Open',
        lines: [
          { label: 'Format', value: 'One-on-one, limited prep · 26 min' },
          {
            label: 'Resolution',
            value:
              'Five appear when the room opens. You strike in turn, then 20 minutes to prepare.',
          },
          { label: 'Decision', value: 'One judge' },
          {
            label: 'Ballots',
            value:
              'Your coach sees them when the round closes. You see scores and feedback after prelims.',
          },
          { label: 'Recording', value: 'Recorded and released to you' },
        ],
      },
      runOfShow: null,
      help: {
        text: 'Seats are assigned by the tournament.',
        action: sampleAction('Something wrong? Message tab'),
      },
    },
    'impromptu-section-c': {
      arrangement: 'section',
      back: {
        label: 'Winter Classic',
        href: tabRoutes.tournament('winter-classic'),
      },
      title: 'Impromptu · Round 1 · Section C',
      lede: 'Six speakers · two judges',
      seats: [
        seat('1', 'neutral', 'Tomas Ruiz', 'Lakeside · speaks 1st', 'Here'),
        seat('2', 'neutral', 'Hana Kim', 'Hartwell · speaks 2nd', 'Here'),
        seat('3', 'neutral', 'Priya Nair', 'Ridgeview · speaks 3rd', 'Here'),
        seat(
          '4',
          'neutral',
          'Ada Okafor',
          'Okafor family · speaks 4th',
          'Here',
        ),
        seat('5', 'clay', you('Wu'), 'Hartwell · speaks 5th', 'Here'),
        seat('6', 'neutral', 'Leo Brandt', 'Hartwell · speaks 6th', 'Here'),
        seat('2', 'teal', 'Two judges', 'S. Cho, A. Costa', null),
      ],
      primary: judging
        ? linkTo(
            'Open your ballot',
            tabRoutes.ballot('impromptu-section-c'),
            true,
          )
        : linkTo(
            'Go to the section',
            tabRoutes.liveRoom('impromptu-section-c'),
            true,
          ),
      primaryNote: null,
      pinned: {
        setBy: 'Winter Classic',
        lines: [
          { label: 'Format', value: 'Six speeches of up to 7 minutes' },
          {
            label: 'Resolution',
            value: 'Your topic appears 2 minutes before your turn.',
          },
          { label: 'Decision', value: 'Two judges rank all six' },
          { label: 'Ballots', value: 'Coach tonight, you after prelims' },
        ],
      },
      runOfShow: null,
      help: {
        text: 'The speaking order is assigned by the tournament.',
        action: tab,
      },
    },
    'championship-round-2-room-4': {
      arrangement: 'four_sides',
      back: { label: 'Championship', href: tabRoutes.tournament(CHAMPIONSHIP) },
      title: 'Round 2 · Room 4',
      lede: 'British Parliamentary · opens in 6 minutes',
      seats: [
        seat(
          'OG',
          'sky',
          'Hartwell A',
          'Opening Government',
          'Here',
          'Jensen, Amari',
        ),
        seat(
          'OO',
          'clay',
          scene.viewer === 'competitor' ? 'You and Okoye' : 'Wu and Okoye',
          'Opening Opposition',
          'Here',
          'Ridgeview B',
        ),
        seat(
          'CG',
          'sky',
          'Lakeside A',
          'Closing Government',
          '1 of 2',
          'Petrov, Mbeki',
        ),
        seat(
          'CO',
          'clay',
          'Ridgeview C',
          'Closing Opposition',
          'Not yet',
          'Sato, Doyle',
        ),
        seat(
          '3',
          'teal',
          'Three judges',
          'Malik chairs · Nguyen, Costa',
          '2 of 3',
        ),
      ],
      primary: judging
        ? linkTo(
            'Open your ballot',
            tabRoutes.ballot('championship-round-2-room-4'),
            true,
          )
        : check,
      primaryNote: null,
      pinned: {
        setBy: 'Championship',
        lines: [
          { label: 'Format', value: 'Four teams of two · 56 min' },
          { label: 'Resolution', value: 'One for all, at 14:45' },
          { label: 'Decision', value: 'Judges rank the four teams' },
          { label: 'Ballots', value: 'Coach tonight, you after prelims' },
        ],
      },
      runOfShow: null,
      help: { text: 'Positions are assigned by the tournament.', action: tab },
    },
    'homework-open': {
      arrangement: 'open',
      back: { label: 'Lobby', href: '/lobby' },
      title: 'Should homework be optional?',
      lede: 'Open conversation · hosted by mira_k · not rated',
      seats: [
        seat('M', 'teal', 'mira_k', 'Speaker · host', 'Ready'),
        seat('Y', 'teal', 'You', 'Speaker', 'Not ready'),
        {
          ...seat('+', 'neutral', 'Open seat', 'Anyone in the lobby', null),
          action: sampleAction('Invite'),
        },
      ],
      primary: sampleAction("I'm ready", true),
      primaryNote: 'The host starts the round.',
      pinned: null,
      runOfShow: {
        heading: 'Run of show · 22 minutes',
        steps: [
          {
            title: 'Opening',
            detail: 'Each speaker in turn',
            length: '2:00 each',
          },
          { title: 'Open talk', detail: 'Everyone may speak', length: '12:00' },
          {
            title: 'Closing',
            detail: 'Each speaker in turn',
            length: '1:00 each',
          },
        ],
        note: 'No judge and no winner. Nothing is recorded.',
      },
      help: null,
    },
  };
}

export const sampleRoom = (
  id: string,
  scene: SampleScene,
): WaitingRoom | null => rooms(scene)[id] ?? null;

export const sampleRoomIds = [
  'round-4-room-5',
  'semifinal-room-1',
  'impromptu-section-c',
  'championship-round-2-room-4',
  'homework-open',
] as const;

export function sampleLiveSection(
  id: string,
  _scene: SampleScene,
): LiveSection | null {
  if (id !== 'impromptu-section-c') return null;
  return {
    title: 'Impromptu · Round 2 · Section C',
    speaker: {
      name: 'Priya Nair',
      position: 'Speaker 3 of 6',
      topic: 'The best advice is unasked for',
      clock: '3:42',
    },
    yourTurn: {
      heading: 'You speak 5th · about 9 minutes',
      detail:
        'Your topic appears 2 minutes before your turn. Your microphone opens when the clock starts.',
    },
    order: [
      {
        name: 'Tomas Ruiz',
        school: 'Lakeside',
        state: 'done',
        time: '5:48',
        you: false,
      },
      {
        name: 'Hana Kim',
        school: 'Hartwell',
        state: 'done',
        time: '6:02',
        you: false,
      },
      {
        name: 'Priya Nair',
        school: 'Ridgeview',
        state: 'speaking',
        time: null,
        you: false,
      },
      {
        name: 'Ada Okafor',
        school: 'Okafor family',
        state: 'preparing',
        time: null,
        you: false,
      },
      { name: 'You', school: null, state: 'waiting', time: null, you: true },
      {
        name: 'Leo Brandt',
        school: 'Hartwell',
        state: 'waiting',
        time: null,
        you: false,
      },
    ],
    note: 'Two judges rank all six when the last speech ends. Everyone else is muted while a speaker has the floor.',
    message: tab,
  };
}
