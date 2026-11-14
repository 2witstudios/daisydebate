import type { Choice, TabAction } from './action';
import { sampleHostLeague, sampleLeagueRail } from './sample/league';
import { sampleCreateRoom } from './sample/create-room';
import { sampleLeagueLobby } from './sample/league-lobby';
import type { SampleScene } from './sample/scene';
import type { ResolvedSetting } from './settings';
import type { TimelineRail, TournamentGroup } from './tournament';
import type { LeagueTab } from './routes';

export type SeasonRow = {
  readonly place: number;
  readonly name: string;
  readonly school: string;
  readonly points: number;
  /** The viewer's own line, pinned first and marked. */
  readonly you: boolean;
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
  /** Wins and losses on this ladder, e.g. `14–9`. */
  readonly record: string;
  readonly rating: number;
  /** The rating's change over the last rated Room. */
  readonly change: number;
  readonly you: boolean;
  readonly profile: TabAction;
};

export type LadderScope = 'top' | 'around';

/** One tab of a league's lobby, with what its address chose on it. */
export type LeagueView =
  | { readonly tab: 'rooms' }
  | {
      readonly tab: 'ladder';
      readonly scope: LadderScope;
      readonly search: string;
    }
  | { readonly tab: 'season'; readonly event: string | null }
  | { readonly tab: 'tournaments' };

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
  | {
      readonly kind: 'ladder';
      /** Where the scope and search are sent: this tab's own address. */
      readonly address: string;
      readonly scope: LadderScope;
      readonly search: string;
      readonly rows: readonly LadderRow[];
      readonly count: string;
      readonly next: TabAction | null;
      readonly note: string;
      readonly rules: TabAction;
    }
  | {
      readonly kind: 'season';
      readonly address: string;
      readonly season: string;
      readonly events: readonly {
        readonly slug: string;
        readonly name: string;
      }[];
      readonly event: string;
      readonly rows: readonly SeasonRow[];
      readonly all: TabAction;
      readonly points: readonly {
        readonly label: string;
        readonly points: number;
      }[];
      readonly note: string;
      readonly tournaments: TabAction;
    }
  | {
      readonly kind: 'tournaments';
      readonly groups: readonly TournamentGroup[];
      readonly note: string;
    };

/** A league's standing lobby, as one of its members sees it. */
export type LeagueLobby = {
  readonly name: string;
  readonly lede: string;
  /** Null for someone who is not a member: only members open rooms here. */
  readonly create: TabAction | null;
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
  readonly name: string;
  readonly templates: readonly {
    readonly name: string;
    readonly detail: string;
  }[];
  readonly template: string;
  /** Who enforces the locked values: the organization that owns the template. */
  readonly lockedBy: string;
  readonly locked: readonly ResolvedSetting[];
  readonly defaults: readonly Choice[];
  readonly ranked: {
    readonly label: string;
    readonly detail: string;
    readonly checked: boolean;
  };
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
  view: LeagueView,
  scene: SampleScene,
): LeagueLobby | null => sampleLeagueLobby(slug, view, scene);

/** The view an address asks for; anything unknown reads as the Rooms tab. */
export function leagueViewOf(query: {
  readonly tab: string | null;
  readonly scope: string | null;
  readonly search: string | null;
  readonly event: string | null;
}): LeagueView {
  switch (query.tab) {
    case 'ladder':
      return {
        tab: 'ladder',
        scope: query.scope === 'around' ? 'around' : 'top',
        search: (query.search ?? '').trim().slice(0, 40),
      };
    case 'season':
      return { tab: 'season', event: query.event };
    case 'tournaments':
      return { tab: 'tournaments' };
    case 'rooms':
    case null:
    default:
      return { tab: 'rooms' };
  }
}

export const readCreateRoom = (
  slug: string,
  scene: SampleScene,
): CreateRoom | null => sampleCreateRoom(slug, scene);
