import type { TabAction } from './action';
import { sampleBracket, sampleEventResults } from './sample/results';
import type { SampleScene } from './sample/scene';

export type BracketSide = {
  readonly seed: number;
  readonly name: string;
  /** Ballots won, once the fixture has a result. */
  readonly ballots: number | null;
  readonly won: boolean;
};

export type BracketTie = {
  readonly top: BracketSide;
  readonly bottom: BracketSide;
  readonly room: string | null;
  readonly watch: TabAction | null;
};

export type BracketStage = {
  readonly name: string;
  readonly state: 'done' | 'live' | 'upcoming';
  readonly time: string | null;
  readonly ties: readonly BracketTie[];
  /** What an empty stage waits on. */
  readonly note: string | null;
};

/** The elimination tree only. */
export type Bracket = { readonly stages: readonly BracketStage[] };

/** One audience of a ballot part, and whether it has opened. */
export type AudienceOpening = {
  readonly audience: string;
  readonly detail: string;
  /** Null once a release records the opening. */
  readonly open: TabAction | null;
};

export type CertifyCheck = {
  readonly kind: 'held_ballots' | 'correction' | 'sanction';
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction | null;
};

export type EventResults = {
  readonly lede: string;
  readonly certify: { readonly label: string; readonly blocked: boolean };
  readonly bracket: Bracket;
  readonly audiencesHeading: string;
  readonly audiences: readonly AudienceOpening[];
  readonly checks: readonly CertifyCheck[];
};

export const readEventResults = (
  slug: string,
  scene: SampleScene,
): EventResults | null => sampleEventResults(slug, scene);

export const readBracket = (
  slug: string,
  event: string | null,
  scene: SampleScene,
): Bracket | null => sampleBracket(slug, event, scene);
