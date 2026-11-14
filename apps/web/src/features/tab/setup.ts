import type { Choice, TabAction } from './action';
import { sampleSetup } from './sample/setup';
import type { SampleScene } from './sample/scene';
import type { ResolvedSetting } from './settings';

/** How hard the engine tries to keep a pairing or judging policy. */
export type PolicyForce = 'rule' | 'preference' | 'warning' | 'off';

export type PairingPolicy = {
  readonly key: string;
  readonly label: string;
  readonly force: PolicyForce;
  /** A preference's place in the order preferences give way. */
  readonly rank: number | null;
};

/** A host picks a preset; only an organization sets force key by key. */
export type PairingPanel = {
  readonly preset: Choice;
  /** What the chosen preset does, before the policies it comes with. */
  readonly summary: string;
  readonly policies: readonly PairingPolicy[];
  /** Who may set a policy's force one by one. */
  readonly forceNote: string;
  readonly save: TabAction;
};

/** Which event a host screen shows, and the way to each of the others. */
export type EventSwitch = {
  readonly current: string;
  readonly position: string;
  readonly others: readonly TabAction[];
};

export type TournamentSetup = {
  readonly event: EventSwitch;
  readonly lede: string;
  readonly settings: readonly ResolvedSetting[];
  readonly pairing: PairingPanel;
};

export const readSetup = (
  slug: string,
  scene: SampleScene,
): TournamentSetup | null => sampleSetup(slug, scene);
