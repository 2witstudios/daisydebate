import type { Choice, TabAction } from './action';
import { sampleResolutionPool } from './sample/resolutions';
import type { SampleScene } from './sample/scene';
import type { EventSwitch } from './setup';

export type PoolResolution = {
  readonly text: string;
  readonly origin: string;
  /** Held back from every draw until it is released. */
  readonly held: boolean;
  readonly edit: TabAction | null;
};

/** How a tab round gives each Room its resolution, and when. */
export type RoundResolutionRule = {
  readonly rounds: string;
  readonly timing: string;
  /** Null once the rounds have been released: the rule can no longer change. */
  readonly rule: Choice | null;
};

export type ResolutionPool = {
  readonly event: EventSwitch;
  readonly setup: TabAction;
  readonly lede: string;
  readonly add: TabAction;
  readonly pool: readonly PoolResolution[];
  readonly more: TabAction | null;
  readonly byRound: readonly RoundResolutionRule[];
  readonly unreleased: {
    readonly heading: string;
    readonly text: string;
    readonly readers: string;
    readonly release: TabAction;
  } | null;
};

export const readResolutionPool = (
  slug: string,
  event: string,
  scene: SampleScene,
): ResolutionPool | null => sampleResolutionPool(slug, event, scene);
