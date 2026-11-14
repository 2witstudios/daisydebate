import type { TabAction } from './action';
import { sampleLiveSection, sampleRoom } from './sample/rooms';
import type { SampleScene } from './sample/scene';

/** How a Room's seats are arranged, which follows from its format. */
export type SeatArrangement = 'panel' | 'section' | 'four_sides' | 'open';

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

export type RunOfShowStep = {
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
  readonly state: 'done' | 'speaking' | 'preparing' | 'waiting';
  readonly time: string | null;
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

export const readRoom = (id: string, scene: SampleScene): WaitingRoom | null =>
  sampleRoom(id, scene);

export const readLiveSection = (
  id: string,
  scene: SampleScene,
): LiveSection | null => sampleLiveSection(id, scene);
