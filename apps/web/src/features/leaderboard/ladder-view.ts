import type { Bloom } from './bloom';
import type { LadderStatus } from './query';
import type { Season } from './season';
import type { LadderEntry } from './standing';

/** Rows per page of the table. */
export const PAGE_SIZE = 15;
/** Below this many established debaters a live season is "early". */
export const EARLY_SEASON_ESTABLISHED = 10;

/**
 * Who is looking. `blinded` names the debaters of the viewer's current
 * assignment as a judge: their rating, rank and band stay hidden until the
 * ballot is submitted (mock assumption, flagged for the owner).
 */
export type LadderViewer = {
  readonly username: string;
  readonly blinded: readonly string[];
};

export type Change =
  | { readonly kind: 'none' }
  | { readonly kind: 'up' | 'down' | 'flat'; readonly amount: number };

export type LadderRow = {
  readonly key: string;
  /** Null for a deleted account. */
  readonly username: string | null;
  readonly rank: number | null;
  readonly rating: number;
  /** The 95% range around the rating: twice its deviation. */
  readonly range: number;
  readonly bloom: Bloom;
  readonly provisional: boolean;
  readonly wins: number;
  readonly losses: number;
  readonly change: Change;
  readonly me: boolean;
  /** True while the viewer judges this debater: no rating, rank or band. */
  readonly masked: boolean;
  readonly selected: boolean;
  /** Opens the detail; null for a deleted account, which is not a link. */
  readonly href: string | null;
};

export type Pinned =
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'established';
      readonly rank: number;
      readonly row: LadderRow;
      readonly jumpHref: string;
    }
  | {
      readonly kind: 'provisional';
      readonly row: LadderRow;
      readonly played: number;
      readonly remaining: number;
      readonly percent: number;
      readonly wouldRank: number;
      readonly jumpHref: string;
    };

export type Champion = {
  readonly season: number;
  readonly username: string;
  readonly rating: number;
};

/** What the read seam returns for one season. */
export type LadderData = {
  readonly season: Season;
  readonly seasons: readonly Season[];
  readonly entries: readonly LadderEntry[];
  /** The previous season's champion, for a season that has just opened. */
  readonly previousChampion: Champion | null;
  /** Standings changes waiting on the feed since the page loaded. */
  readonly pendingChanges: number;
};

export type LadderView = {
  readonly season: Season;
  readonly seasons: readonly Season[];
  readonly rows: readonly LadderRow[];
  readonly podium: readonly LadderRow[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly established: number;
  readonly provisional: number;
  /** The "around me" window is showing. */
  readonly around: boolean;
  readonly gapNote: string;
  /** The table is empty because of a search or filter, not the season. */
  readonly empty: 'no' | 'filtered' | 'provisional-hits' | 'new-season';
  readonly provisionalHits: number;
  /** A live season with few established debaters: Everyone is showing. */
  readonly early: boolean;
  readonly status: LadderStatus;
  readonly pinned: Pinned;
  /** Whether the viewer has a line in this season (shows "Around me"). */
  readonly hasStanding: boolean;
  readonly previousChampion: Champion | null;
  readonly pendingChanges: number;
  readonly filtered: boolean;
};
