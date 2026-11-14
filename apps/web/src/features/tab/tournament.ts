import type { TabAction } from './action';
import type { Bracket } from './results';
import { sampleTimelineRail } from './sample/rail';
import {
  sampleTournamentPage,
  sampleTournamentsIndex,
} from './sample/tournament';
import type { SampleScene } from './sample/scene';
import type { StandingsTable } from './standings';

/**
 * Where a stop stands. The first five ask something of the host, in that
 * order of urgency; `note` is a count, a start time or a word that asks
 * nothing.
 */
export type RailStanding =
  | { readonly kind: 'needs_you'; readonly count: number }
  | { readonly kind: 'live' }
  | { readonly kind: 'draft' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'unfinished'; readonly count: number }
  // A stop that is over, in its own word when it has one (`certified`).
  | { readonly kind: 'done'; readonly as?: string }
  | { readonly kind: 'note'; readonly text: string };

/** One stop on the timeline rail: a setup page, a time slot or the results. */
export type RailItem = {
  readonly id: string;
  readonly label: string;
  /** A time slot's start, shown before its name when events share slots. */
  readonly time: string | null;
  readonly standing: RailStanding | null;
  /** Null for a stop that cannot be opened yet. */
  readonly action: TabAction | null;
};

/** The host area's navigation: one tournament or league, in order. */
export type TimelineRail = {
  readonly title: string;
  readonly subtitle: string | null;
  /** A label over the stops, where they are not one tournament's timeline. */
  readonly heading: string | null;
  readonly items: readonly RailItem[];
  readonly footHeading: string | null;
  readonly foot: readonly RailItem[];
};

export type PinnedRoom = {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction;
};

export type PostingRow = {
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction | null;
};

export type DayRow = {
  readonly time: string;
  readonly title: string;
  readonly detail: string;
  readonly href: string | null;
};

export type TournamentPanel =
  | {
      readonly kind: 'posting';
      readonly heading: string;
      readonly rows: readonly PostingRow[];
      readonly more: number;
    }
  | {
      readonly kind: 'day';
      readonly groups: readonly {
        readonly heading: string;
        readonly rows: readonly DayRow[];
      }[];
    }
  /** Not open to this viewer yet. */
  | { readonly kind: 'closed'; readonly title: string }
  | { readonly kind: 'standings'; readonly table: StandingsTable }
  | { readonly kind: 'bracket'; readonly bracket: Bracket };

export type TournamentTab = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly selected: boolean;
};

/** A responsible adult's entry at a tournament, as it stands right now. */
export type AdultEntry = {
  readonly name: string;
  readonly facts: string;
  readonly detail: string;
  readonly action: TabAction;
};

/** Something of a round this viewer may open: a ballot, a recording. */
export type ReadableBallot = {
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction;
};

/** What a finished tournament keeps for someone who took part. */
export type Keepsakes = {
  readonly rows: readonly ReadableBallot[];
  /** The earlier rounds, behind one link. */
  readonly more: TabAction;
};

/** The participant side's tournament page, by who is looking and when. */
export type TournamentPage =
  | {
      readonly kind: 'before';
      readonly name: string;
      readonly lede: string;
      readonly places: string;
      readonly closes: string;
      readonly enter: TabAction;
      readonly terms: readonly {
        readonly title: string;
        readonly detail: string;
      }[];
      readonly entered: string | null;
    }
  | {
      readonly kind: 'rounds';
      readonly name: string;
      readonly lede: string;
      readonly headerAction: TabAction | null;
      readonly yourRoom: PinnedRoom | null;
      readonly tabs: readonly TournamentTab[];
      readonly panel: TournamentPanel;
      readonly note: string | null;
      readonly noteAction: TabAction | null;
      /** A signed-out reader's way in. */
      readonly signIn: TabAction | null;
    }
  | {
      readonly kind: 'adult';
      readonly name: string;
      readonly lede: string;
      readonly now: readonly AdultEntry[];
      readonly ballots: readonly ReadableBallot[];
      readonly ballotsNote: string;
      readonly judging: PinnedRoom | null;
      readonly manage: TabAction;
    }
  | {
      /** A finished tournament, for someone who took part in it. */
      readonly kind: 'after';
      readonly name: string;
      readonly lede: string;
      readonly result: PinnedRoom;
      readonly ballots: Keepsakes;
      readonly recordings: Keepsakes;
      readonly recordingsNote: string;
    };

export type TournamentView =
  | { readonly kind: 'home' }
  | { readonly kind: 'round'; readonly event: string; readonly round: string }
  | { readonly kind: 'standings'; readonly event: string | null }
  | { readonly kind: 'bracket'; readonly event: string | null };

/** A tournament in a list: the index, a league's tournaments. */
export type TournamentRow = {
  readonly name: string;
  readonly detail: string;
  readonly action: TabAction;
};

export type TournamentGroup = {
  readonly heading: string;
  readonly rows: readonly TournamentRow[];
  /** The rest of the group, behind one link. */
  readonly more: TabAction | null;
};

/** The tournaments index: this viewer's own first, then what is open. */
export type TournamentsIndex = {
  readonly groups: readonly TournamentGroup[];
  /** Null for a signed-out reader. */
  readonly host: TabAction | null;
};

export const readTimelineRail = (
  slug: string,
  scene: SampleScene,
): TimelineRail | null => sampleTimelineRail(slug, scene);

export const readTournamentPage = (
  slug: string,
  view: TournamentView,
  scene: SampleScene,
): TournamentPage | null => sampleTournamentPage(slug, view, scene);

export const readTournamentsIndex = (scene: SampleScene): TournamentsIndex =>
  sampleTournamentsIndex(scene);

/** A stop's standing in the words the rail shows. */
export const standingLabel = (standing: RailStanding): string => {
  switch (standing.kind) {
    case 'needs_you':
      return standing.count === 1
        ? '1 needs you'
        : `${standing.count} need you`;
    case 'unfinished':
      return `${standing.count} to finish`;
    case 'note':
      return standing.text;
    case 'done':
      return standing.as ?? standing.kind;
    case 'live':
    case 'draft':
    case 'ready':
      return standing.kind;
  }
};

const urgency: readonly RailStanding['kind'][] = [
  'needs_you',
  'live',
  'draft',
  'ready',
  'unfinished',
];

/**
 * Where a host lands on opening a tournament: the stop that most wants them.
 * With nothing wanting them they land on the last stop when that one is over
 * (a finished tournament opens on its results), and on the first otherwise.
 */
export function landingStop(rail: TimelineRail): string | null {
  const open = rail.items.filter(
    (item) => item.action !== null && item.action.href !== null,
  );
  const wanted = urgency
    .map((kind) => open.find((item) => item.standing?.kind === kind))
    .find((item) => item !== undefined);
  const last = open.at(-1);
  const rest = last?.standing?.kind === 'done' ? last : open[0];
  return (wanted ?? rest)?.action?.href ?? null;
}
