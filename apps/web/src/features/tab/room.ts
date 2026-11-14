import type { EventRoomView } from '@daisy/protocol/lobby/event-room-read';
import { sampleAction, type TabAction } from './action';
import { tabRoutes } from './routes';
import {
  sampleEventRoom,
  sampleLiveSection,
  sampleStandingRoom,
} from './sample/rooms';
import type { SampleScene } from './sample/scene';
import { sampleAddressOf } from './sample/tournament';
import {
  actionTo,
  capitalized,
  numberWord,
  opensPhrase,
  ordinalOf,
  type AddressOf,
} from './tournament';

/** How a Room's seats are arranged, which follows from its format. */
type SeatArrangement = 'panel' | 'section' | 'four_sides' | 'open';

export type RoomSeat = {
  readonly mark: string;
  readonly tone: 'sky' | 'clay' | 'teal' | 'neutral';
  readonly name: string;
  readonly members: string | null;
  readonly role: string;
  readonly status: string | null;
  readonly here: boolean;
  readonly action: TabAction | null;
};

type RunOfShowStep = {
  readonly title: string;
  readonly detail: string;
  readonly length: string;
};

/** A Room before its Round starts: an event Room, or one in a standing lobby. */
export type WaitingRoom = {
  readonly arrangement: SeatArrangement;
  readonly back: { readonly label: string; readonly href: string };
  readonly title: string;
  readonly lede: string;
  readonly seats: readonly RoomSeat[];
  readonly primary: TabAction;
  readonly primaryNote: string | null;
  /** What publishing pinned on an event Room, and the lobby that set it. */
  readonly pinned: {
    readonly setBy: string;
    readonly lines: readonly {
      readonly label: string;
      readonly value: string;
    }[];
  } | null;
  /** An open Room's segments in order. */
  readonly runOfShow: {
    readonly heading: string;
    readonly steps: readonly RunOfShowStep[];
    readonly note: string;
  } | null;
  readonly help: { readonly text: string; readonly action: TabAction } | null;
};

export type SectionSpeaker = {
  readonly name: string;
  readonly school: string | null;
  /** Where they are in the order; a finished speaker carries their time. */
  readonly standing:
    | { readonly kind: 'done'; readonly time: string }
    | { readonly kind: 'speaking' | 'preparing' | 'waiting' };
  readonly you: boolean;
};

/** A speech section while its Round is live, as one of its speakers sees it. */
export type LiveSection = {
  readonly title: string;
  readonly speaker: {
    readonly name: string;
    readonly position: string;
    readonly topic: string;
    readonly clock: string;
  };
  readonly yourTurn: { readonly heading: string; readonly detail: string };
  readonly order: readonly SectionSpeaker[];
  readonly note: string;
  readonly message: TabAction;
};

const lineLabels: Readonly<
  Record<EventRoomView['pinned']['lines'][number]['line'], string>
> = {
  format: 'Format',
  resolution: 'Resolution',
  decision: 'Decision',
  ballots: 'Ballots',
  recording: 'Recording',
};

/** Whether an entry's people have arrived: all, none, or some. */
const presence = (entry: EventRoomView['entries'][number]): string =>
  entry.present === entry.of
    ? 'Here'
    : entry.present === 0
      ? 'Not yet'
      : `${entry.present} of ${entry.of}`;

const initialsOf = (side: string): string =>
  side
    .split(' ')
    .map((word) => word.charAt(0))
    .join('');

/** The panel's seat: its size, and who chairs or who has arrived. */
function panelSeat(room: EventRoomView): RoomSeat {
  const judges = room.judges;
  const name = (judge: (typeof judges)[number]) =>
    judge.own ? 'You' : judge.name;
  const chair = judges.find((judge) => judge.chair);
  const away = judges.filter((judge) => !judge.present);
  const role =
    chair !== undefined
      ? `${name(chair)} chairs · ${judges
          .filter((judge) => !judge.chair)
          .map(name)
          .join(', ')}`
      : away.length > 0
        ? `${judges
            .filter((judge) => judge.present)
            .map(name)
            .join(', ')} here · ${away.map(name).join(', ')} not yet`
        : judges.map(name).join(', ');
  const status =
    chair === undefined
      ? null
      : `${judges.length - away.length} of ${judges.length}`;
  return {
    mark: String(judges.length),
    tone: 'teal',
    name: `${capitalized(numberWord(judges.length))} judge${judges.length === 1 ? '' : 's'}`,
    members: null,
    role,
    status,
    here: false,
    action: null,
  };
}

/**
 * An event Room before its Round starts: the fixture's seats, who has
 * arrived, and what publishing pinned on it with the scope that set it.
 */
function waitingRoomOf(room: EventRoomView, addressOf: AddressOf): WaitingRoom {
  const arrangement: Exclude<SeatArrangement, 'open'> =
    room.kind === 'section'
      ? 'section'
      : room.entries.length > 2
        ? 'four_sides'
        : 'panel';
  const round = room.tabRound.name ?? `Round ${room.tabRound.number}`;
  const opens = opensPhrase(room.opensAt, room.asOf);
  const seat = (
    entry: EventRoomView['entries'][number],
    index: number,
  ): RoomSeat => {
    const status = presence(entry);
    const base = {
      members: null,
      status,
      here: status === 'Here',
      action: null,
    };
    switch (arrangement) {
      case 'section':
        return {
          ...base,
          mark: String(entry.speaks ?? index + 1),
          tone: entry.own ? 'clay' : 'neutral',
          name: entry.own ? 'You' : entry.name,
          role: `${entry.school ?? ''} · speaks ${ordinalOf(entry.speaks ?? index + 1)}`,
        };
      case 'four_sides':
        return {
          ...base,
          mark: initialsOf(entry.side ?? ''),
          tone: index % 2 === 0 ? 'sky' : 'clay',
          name: entry.own
            ? entry.members
                .map((member) => (member.own ? 'You' : member.name))
                .join(' and ')
            : entry.name,
          members: entry.own
            ? entry.name
            : entry.members.map((member) => member.name).join(', '),
          role: entry.side ?? '',
        };
      case 'panel': {
        const name = entry.own ? 'You' : entry.name;
        return {
          ...base,
          mark: name.charAt(0),
          tone: index === 0 ? 'sky' : 'clay',
          name,
          role: `${entry.side ?? ''}${entry.seed === null ? '' : ` · seed ${entry.seed}`}`,
        };
      }
    }
  };
  const ballot = addressOf({ kind: 'ballot', roomId: room.roomId });
  const live = addressOf({ kind: 'live_room', roomId: room.roomId });
  return {
    arrangement,
    back: {
      label: room.lobby.name,
      href:
        addressOf({ kind: 'tournament', handle: room.lobby.handle }) ??
        tabRoutes.tournament(room.lobby.handle),
    },
    title:
      arrangement === 'section'
        ? `${room.event.name} · ${round} · ${room.roomName}`
        : `${round} · ${room.roomName}`,
    lede:
      arrangement === 'section'
        ? `${capitalized(numberWord(room.entries.length))} speakers · ${numberWord(room.judges.length)} judges`
        : arrangement === 'four_sides'
          ? `${room.event.name} · ${opens}`
          : capitalized(opens),
    seats: [...room.entries.map(seat), panelSeat(room)],
    primary: room.capabilities.ballot
      ? actionTo('Open your ballot', ballot, true)
      : arrangement === 'section'
        ? actionTo('Go to the section', live, true)
        : sampleAction('Check camera and microphone', true),
    primaryNote: null,
    pinned: {
      setBy: 'name' in room.pinned.source ? room.pinned.source.name : 'Daisy',
      lines: room.pinned.lines.map((one) => ({
        label: lineLabels[one.line],
        value: one.text,
      })),
    },
    runOfShow: null,
    help:
      arrangement === 'section'
        ? {
            text: 'The speaking order is assigned by the tournament.',
            action: sampleAction('Message tab'),
          }
        : arrangement === 'four_sides'
          ? {
              text: 'Positions are assigned by the tournament.',
              action: sampleAction('Message tab'),
            }
          : {
              text: 'Seats are assigned by the tournament.',
              action: sampleAction('Something wrong? Message tab'),
            },
  };
}

export const readRoom = (
  id: string,
  scene: SampleScene,
): WaitingRoom | null => {
  const room = sampleEventRoom(id, scene);
  return room === null
    ? sampleStandingRoom(id, scene)
    : waitingRoomOf(room, sampleAddressOf);
};

export const readLiveSection = (
  id: string,
  scene: SampleScene,
): LiveSection | null => sampleLiveSection(id, scene);
