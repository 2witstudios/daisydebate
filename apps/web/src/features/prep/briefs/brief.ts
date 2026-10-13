import type { Side, Visibility } from '../library/library-item';

export type BriefCardRef = {
  readonly cardId: string;
  readonly title: string;
  readonly cite: string;
};

export type BriefResponse = { readonly say: string; readonly we: string };

export type Contention = {
  readonly id: string;
  readonly tag: string;
  readonly claim: string;
  readonly warrant: string;
  readonly impact: string;
  readonly cards: readonly BriefCardRef[];
  readonly responses: readonly BriefResponse[];
};

export type Brief = {
  readonly id: string;
  readonly title: string;
  readonly side: Side;
  readonly motion: string;
  readonly visibility: Visibility;
  /** When it was last saved, as shown ("12:04"); empty for a new brief. */
  readonly savedAt: string;
  readonly framing: {
    readonly motion: string;
    readonly burden: string;
    readonly cards: readonly BriefCardRef[];
  };
  readonly contentions: readonly Contention[];
};
