import type { Ladder } from '@daisy/protocol/ladder';
import type { StandingRoomCreation } from './standing-room-creation';
import type { TabAction } from './action';
import type { ResolvedSettingsView } from '@daisy/protocol/lobby/resolved-settings-read';
import type { TemplateView } from '@daisy/protocol/lobby/template-read';
import type { LadderScope } from './league-view';
import type { TournamentGroup } from './tournament';
import type { SettingLine } from './settings';
import type { LeagueTab } from './routes';

export type { LeagueView } from './league-view';

export type SeasonRow = {
  readonly place: number;
  readonly name: string;
  readonly school: string;
  readonly points: number;
  /** The viewer's own line, pinned first and marked. */
  readonly you: boolean;
};

/** An event asking a league to count its certified results for the season. */
type SanctionRequest = {
  readonly id?: string;
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
  readonly lobbyView: TabAction | null;
  readonly requests: readonly SanctionRequest[];
  readonly template: {
    readonly name: string;
    readonly settings: readonly SettingLine[];
    readonly edit: TabAction | null;
    readonly note: string;
  } | null;
  readonly season: {
    readonly heading: string;
    readonly rows: readonly SeasonRow[];
    readonly note: string;
    readonly rule: TabAction | null;
  };
  readonly ladder: { readonly detail: string; readonly open: TabAction | null };
  readonly lobby: readonly SettingLine[];
};

type LobbyRoomRow = {
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
      readonly seasonId?: string;
      readonly address: string;
      readonly season: string;
      readonly events: readonly {
        readonly slug: string;
        readonly name: string;
      }[];
      readonly event: string;
      readonly rows: readonly SeasonRow[];
      readonly all: TabAction | null;
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
  /** The league's own ladder: Freestyle in the league's division (PYL-16). */
  readonly ladder: Ladder;
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

/** What the form is drawn from: the lobby, the Room draft's view, the offered templates. */
export type CreateRoomReads = {
  readonly creation?: StandingRoomCreation;
  readonly lobby: { readonly name: string; readonly handle: string };
  readonly draft: ResolvedSettingsView;
  /**
   * The lobby's own view, for the ladder its Rooms count for: a key the
   * catalogue reads only on an event's chain, so a draft does not carry it.
   */
  readonly lobbySettings: ResolvedSettingsView;
  readonly templates: readonly TemplateView[];
};
