import type { Brief } from './briefs/brief';
import type { Card, Segment } from './cards/card';
import type { Case } from './cases/case';
import type { LibraryItem } from './library/library-item';
import type { LibraryQuery } from './library/library-query';
import type { ShareRecord } from './sharing';
import type { Team } from './teams/team';

/**
 * What Prep reads, passed in by the page. Nothing stores a card or a brief yet,
 * so only sample data fills it, and the launch flag keeps every page that reads
 * it closed.
 */
export type PrepSource = {
  /** The owner's items at `now`. */
  readonly library: (now: string) => readonly LibraryItem[];
  readonly savedSearches: readonly {
    readonly id: string;
    readonly name: string;
    readonly query: Partial<LibraryQuery>;
  }[];
  readonly cards: readonly Card[];
  /** The source text of the card being drafted, with its layers. */
  readonly draftSegments: readonly Segment[];
  /** The owner's reading pace in words a minute. */
  readonly readingPace: number;
  readonly cases: readonly Case[];
  readonly briefs: readonly Brief[];
  /** What the id for a brand-new brief answers with. */
  readonly emptyBrief: Brief;
  /** The speech limit the debate rules supply, in seconds. */
  readonly speechLimitSeconds: number;
  readonly teams: readonly Team[];
  readonly shares: readonly ShareRecord[];
  /** Team names that exist but do not include the viewer. */
  readonly strangerTeamNames: readonly string[];
};
