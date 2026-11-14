import type {
  EventRoomEntry,
  EventRoomView,
  PinnedSettingLine,
} from '@daisy/protocol/lobby/event-room-read';
import { sampleAction } from '../action';
import type { LiveSection, RoomSeat, WaitingRoom } from '../room';
import { AUTUMN, CHAMPIONSHIP, VARSITY, WINTER } from './moment';
import { own } from './own';
import { sampleId, tabRound } from './posting';
import type { SampleScene } from './scene';

const seat = (
  mark: string,
  tone: RoomSeat['tone'],
  name: string,
  role: string,
  status: string | null,
): RoomSeat => ({
  mark,
  tone,
  name,
  members: null,
  role,
  status,
  here: status === 'Here' || status === 'Ready',
  action: null,
});

const tab = sampleAction('Message tab');

const at = (day: string, time: string) => `${day}T${time}:00.000Z`;
const AUTUMN_DAY = '2026-11-14';

type Entrant = Omit<EventRoomEntry, 'entryId' | 'members' | 'own'> & {
  readonly members?: readonly string[];
  readonly own?: boolean;
};
const entrant = (scene: SampleScene, one: Entrant): EventRoomEntry => ({
  ...one,
  entryId: sampleId(`entry/${one.name}`),
  // The sample competitor is Wu in a team, and Doyle or Wu alone.
  members: (one.members ?? []).map((name) => ({
    name,
    own: scene.viewer === 'competitor' && name === 'Wu',
  })),
  own: scene.viewer === 'competitor' && one.own === true,
});
const seated = (
  name: string,
  side: string | null,
  present: number,
  rest: Partial<Entrant> = {},
): Entrant => ({
  name,
  side,
  seed: null,
  school: null,
  speaks: null,
  present,
  of: 1,
  ...rest,
});
const panelJudge = (
  scene: SampleScene,
  name: string,
  present: boolean,
  chair = false,
  judging = false,
) => ({ name, chair, present, own: judging && scene.viewer === 'judge' });

const autumnLobby = {
  lobbyId: sampleId(AUTUMN),
  handle: AUTUMN,
  name: 'Autumn Open',
};
const pinnedBy = (lobby: {
  readonly lobbyId: string;
  readonly name: string;
}) => ({
  kind: 'lobby' as const,
  id: lobby.lobbyId,
  name: lobby.name,
});

/** The sample's event Rooms, each as one viewer reads it. */
function eventRooms(
  scene: SampleScene,
): Readonly<Record<string, EventRoomView>> {
  const judging = scene.viewer === 'judge';
  const varsity = {
    eventId: sampleId(`${AUTUMN}/${VARSITY}`),
    name: 'Varsity debate',
  };
  const winter = {
    lobbyId: sampleId(WINTER),
    handle: WINTER,
    name: 'Winter Classic',
  };
  const championship = {
    lobbyId: sampleId(CHAMPIONSHIP),
    handle: CHAMPIONSHIP,
    name: 'Championship',
  };
  const room = (
    key: string,
    rest: Omit<EventRoomView, 'roomId' | 'fixtureId'>,
  ): EventRoomView => ({
    roomId: sampleId(key),
    fixtureId: sampleId(`fixture/${key}`),
    ...rest,
  });
  const line = (line: PinnedSettingLine, text: string) => ({ line, text });
  return {
    'semifinal-room-1': room('semifinal-room-1', {
      lobby: autumnLobby,
      asOf: at(AUTUMN_DAY, '17:24'),
      event: varsity,
      tabRound: tabRound(AUTUMN, VARSITY, 6, 'Semifinal', 'elimination'),
      kind: 'pairing',
      roomName: 'Room 1',
      opensAt: at(AUTUMN_DAY, '17:30'),
      state: { kind: 'posted', opensAt: at(AUTUMN_DAY, '17:30') },
      entries: [
        entrant(scene, seated('Jensen', 'Affirmative', 1, { seed: 1 })),
        entrant(scene, seated('Doyle', 'Negative', 1, { seed: 5, own: true })),
      ],
      judges: [
        panelJudge(scene, 'L. Malik', true),
        panelJudge(scene, 'P. Nguyen', true),
        panelJudge(scene, 'A. Costa', false),
      ],
      pinned: {
        source: pinnedBy(autumnLobby),
        lines: [
          line('format', 'One-on-one, limited prep · 26 min'),
          line(
            'resolution',
            'Five appear when the room opens. You and Jensen strike in turn, then 20 minutes to prepare.',
          ),
          line('decision', 'Two of three judges'),
          line(
            'ballots',
            'Your coach sees them tonight. You see scores and feedback after the final.',
          ),
          line('recording', 'Recorded and released to you'),
        ],
      },
      capabilities: { ballot: judging },
    }),
    'round-4-room-5': room('round-4-room-5', {
      lobby: autumnLobby,
      asOf: at(AUTUMN_DAY, '14:00'),
      event: varsity,
      tabRound: tabRound(AUTUMN, VARSITY, 4),
      kind: 'pairing',
      roomName: 'Room 5',
      opensAt: at(AUTUMN_DAY, '15:20'),
      state: { kind: 'posted', opensAt: at(AUTUMN_DAY, '15:20') },
      entries: [
        entrant(scene, seated('Sato', 'Affirmative', 0)),
        entrant(scene, seated('Doyle', 'Negative', 1, { own: true })),
      ],
      judges: [panelJudge(scene, 'R. Keane', true, false, true)],
      pinned: {
        source: pinnedBy(autumnLobby),
        lines: [
          line('format', 'One-on-one, limited prep · 26 min'),
          line(
            'resolution',
            'Five appear when the room opens. You strike in turn, then 20 minutes to prepare.',
          ),
          line('decision', 'One judge'),
          line(
            'ballots',
            'Your coach sees them when the round closes. You see scores and feedback after prelims.',
          ),
          line('recording', 'Recorded and released to you'),
        ],
      },
      capabilities: { ballot: judging },
    }),
    'impromptu-section-c': room('impromptu-section-c', {
      lobby: winter,
      asOf: at('2026-12-12', '10:25'),
      event: { eventId: sampleId(`${WINTER}/impromptu`), name: 'Impromptu' },
      tabRound: tabRound(WINTER, 'impromptu', 1),
      kind: 'section',
      roomName: 'Section C',
      opensAt: at('2026-12-12', '10:30'),
      state: { kind: 'posted', opensAt: at('2026-12-12', '10:30') },
      entries: (
        [
          ['Tomas Ruiz', 'Lakeside'],
          ['Hana Kim', 'Hartwell'],
          ['Priya Nair', 'Ridgeview'],
          ['Ada Okafor', 'Okafor family'],
          ['Wu', 'Hartwell'],
          ['Leo Brandt', 'Hartwell'],
        ] as const
      ).map(([name, school], index) =>
        entrant(
          scene,
          seated(name, null, 1, {
            school,
            speaks: index + 1,
            own: name === 'Wu',
          }),
        ),
      ),
      judges: [
        panelJudge(scene, 'S. Cho', true),
        panelJudge(scene, 'A. Costa', true),
      ],
      pinned: {
        source: pinnedBy(winter),
        lines: [
          line('format', 'Six speeches of up to 7 minutes'),
          line('resolution', 'Your topic appears 2 minutes before your turn.'),
          line('decision', 'Two judges rank all six'),
          line('ballots', 'Coach tonight, you after prelims'),
        ],
      },
      capabilities: { ballot: judging },
    }),
    'championship-round-2-room-4': room('championship-round-2-room-4', {
      lobby: championship,
      asOf: at('2027-03-13', '14:44'),
      event: {
        eventId: sampleId(`${CHAMPIONSHIP}/british-parliamentary`),
        name: 'British Parliamentary',
      },
      tabRound: tabRound(CHAMPIONSHIP, 'british-parliamentary', 2, 'Round 2'),
      kind: 'pairing',
      roomName: 'Room 4',
      opensAt: at('2027-03-13', '14:50'),
      state: { kind: 'posted', opensAt: at('2027-03-13', '14:50') },
      entries: [
        entrant(
          scene,
          seated('Hartwell A', 'Opening Government', 2, {
            of: 2,
            members: ['Jensen', 'Amari'],
          }),
        ),
        entrant(
          scene,
          seated('Ridgeview B', 'Opening Opposition', 2, {
            of: 2,
            members: ['Wu', 'Okoye'],
            own: true,
          }),
        ),
        entrant(
          scene,
          seated('Lakeside A', 'Closing Government', 1, {
            of: 2,
            members: ['Petrov', 'Mbeki'],
          }),
        ),
        entrant(
          scene,
          seated('Ridgeview C', 'Closing Opposition', 0, {
            of: 2,
            members: ['Sato', 'Doyle'],
          }),
        ),
      ],
      judges: [
        panelJudge(scene, 'Malik', true, true),
        panelJudge(scene, 'Nguyen', true),
        panelJudge(scene, 'Costa', false),
      ],
      pinned: {
        source: pinnedBy(championship),
        lines: [
          line('format', 'Four teams of two · 56 min'),
          line('resolution', 'One for all, at 14:45'),
          line('decision', 'Judges rank the four teams'),
          line('ballots', 'Coach tonight, you after prelims'),
        ],
      },
      capabilities: { ballot: judging },
    }),
  };
}

/** The sample's event Room reads, by the Room key its addresses use. */
export const sampleEventRoom = (
  id: string,
  scene: SampleScene,
): EventRoomView | null => own(eventRooms(scene), id);

/**
 * A Room of a standing lobby, drawn as its screen: it reads through the
 * product's Room read (RoomView), which this sample does not build.
 */
export function sampleStandingRoom(
  id: string,
  _scene: SampleScene,
): WaitingRoom | null {
  if (id !== 'homework-open') return null;
  return {
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
  };
}

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
        standing: { kind: 'done', time: '5:48' },
        you: false,
      },
      {
        name: 'Hana Kim',
        school: 'Hartwell',
        standing: { kind: 'done', time: '6:02' },
        you: false,
      },
      {
        name: 'Priya Nair',
        school: 'Ridgeview',
        standing: { kind: 'speaking' },
        you: false,
      },
      {
        name: 'Ada Okafor',
        school: 'Okafor family',
        standing: { kind: 'preparing' },
        you: false,
      },
      { name: 'You', school: null, standing: { kind: 'waiting' }, you: true },
      {
        name: 'Leo Brandt',
        school: 'Hartwell',
        standing: { kind: 'waiting' },
        you: false,
      },
    ],
    note: 'Two judges rank all six when the last speech ends. Everyone else is muted while a speaker has the floor.',
    message: tab,
  };
}
