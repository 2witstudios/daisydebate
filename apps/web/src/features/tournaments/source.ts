import type { BracketData } from './bracket';
import type { ConsoleData } from './console';
import type { Draft } from './create-wizard';
import type { Entry, Viewer } from './entry';
import type { EventData } from './event';
import type { AttentionItem, OrganizedTournament } from './organize-dashboard';
import type { ResultsData } from './results';
import type { Tournament } from './tournament';

/**
 * What Tournaments reads, passed in by the page. Nothing stores a tournament
 * yet, so only sample data fills it, and the launch flag keeps every page that
 * reads it closed.
 */
export type TournamentSource = {
  readonly tournaments: readonly Tournament[];
  readonly viewer: Viewer;
  /** The viewer's entries, by tournament id. */
  readonly entries: Readonly<Record<string, Entry>>;
  readonly roster: readonly {
    readonly handle: string;
    readonly rating: number | null;
  }[];
  readonly description: (name: string) => string;
  readonly bracket: (id: string, now: string) => BracketData | null;
  readonly results: (id: string, signedIn: boolean) => ResultsData | null;
  readonly event: (now: string) => EventData | null;
  readonly console: (id: string) => ConsoleData | null;
  readonly draft: Draft;
  readonly organized: readonly OrganizedTournament[];
  readonly attention: readonly AttentionItem[];
};
