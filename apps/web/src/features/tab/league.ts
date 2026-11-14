import type { Choice, TabAction } from './action';
import {
  sampleCreateRoom,
  sampleHostLeague,
  sampleLeagueLobby,
  sampleLeagueRail,
} from './sample/league';
import type { SampleScene } from './sample/scene';
import type { ResolvedSetting } from './settings';
import type { TimelineRail, TournamentSummary } from './tournament';
import type { LeagueTab } from './routes';

export type SeasonRow = {
  readonly place: number;
  readonly entry: string;
  readonly points: number;
};

/** An event asking a league to count its certified results for the season. */
export type SanctionRequest = {
  readonly event: string;
  readonly facts: string;
  /** The computed check: every enforced value equals the event's own. */
  readonly meets: string;
  readonly decline: TabAction;
  readonly sanction: TabAction;
};

export type HostLeague = {
  readonly name: string;
  readonly lede: string;
  readonly lobbyView: TabAction;
  readonly requests: readonly SanctionRequest[];
  readonly template: {
    readonly name: string;
    readonly settings: readonly ResolvedSetting[];
    readonly edit: TabAction;
    readonly note: string;
  };
  readonly season: {
    readonly heading: string;
    readonly rows: readonly SeasonRow[];
    readonly note: string;
    readonly rule: TabAction;
  };
  readonly ladder: { readonly detail: string; readonly open: TabAction };
  readonly lobby: readonly ResolvedSetting[];
};

export type LobbyRoomRow = {
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction;
};

export type LadderRow = {
  readonly place: number;
  readonly name: string;
  readonly school: string;
  readonly rating: number;
  readonly you: boolean;
};

export type LeaguePanel =
  | {
      readonly kind: 'rooms';
      readonly pool: { readonly title: string; readonly detail: string };
      readonly groups: readonly {
        readonly heading: string;
        readonly rooms: readonly LobbyRoomRow[];
      }[];
      readonly note: string;
    }
  | { readonly kind: 'ladder'; readonly rows: readonly LadderRow[] }
  | {
      readonly kind: 'season';
      readonly heading: string;
      readonly rows: readonly SeasonRow[];
      readonly note: string;
    }
  | {
      readonly kind: 'tournaments';
      readonly tournaments: readonly TournamentSummary[];
    };

/** A league's standing lobby, as one of its members sees it. */
export type LeagueLobby = {
  readonly name: string;
  readonly lede: string;
  readonly create: TabAction;
  readonly tabs: readonly {
    readonly id: LeagueTab;
    readonly label: string;
    readonly href: string;
    readonly selected: boolean;
  }[];
  readonly panel: LeaguePanel;
};

/**
 * The create-room form of a standing lobby: the resolved settings of the
 * template the Room follows. Enforced values are locked; defaults are
 * prefilled and may be changed.
 */
export type CreateRoom = {
  readonly lobby: { readonly name: string; readonly href: string };
  readonly template: Choice;
  readonly locked: readonly ResolvedSetting[];
  readonly defaults: readonly Choice[];
  readonly open: TabAction;
};

export const readLeagueRail = (
  slug: string,
  scene: SampleScene,
): TimelineRail | null => sampleLeagueRail(slug, scene);

export const readHostLeague = (
  slug: string,
  scene: SampleScene,
): HostLeague | null => sampleHostLeague(slug, scene);

export const readLeagueLobby = (
  slug: string,
  tab: LeagueTab,
  scene: SampleScene,
): LeagueLobby | null => sampleLeagueLobby(slug, tab, scene);

export const readCreateRoom = (
  slug: string,
  scene: SampleScene,
): CreateRoom | null => sampleCreateRoom(slug, scene);
