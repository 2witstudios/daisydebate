import type { TabAction } from './action';
import { sampleMinorAccount, sampleTournamentRequest } from './sample/guardian';
import type { SampleScene } from './sample/scene';

/** A lobby a guardian may allow a minor to see and join. */
export type AllowedLobby = {
  readonly name: string;
  readonly detail: string | null;
  readonly allowed: boolean;
};

/** A minor's account as their guardian manages it. */
export type MinorAccount = {
  readonly back: { readonly label: string; readonly href: string };
  readonly name: string;
  readonly lede: string;
  readonly lobbiesLegend: string;
  readonly lobbies: readonly AllowedLobby[];
  readonly recordings: {
    readonly legend: string;
    readonly options: readonly string[];
    readonly chosen: number;
  };
  readonly boundary: string;
  readonly save: TabAction;
  readonly withdraw: TabAction;
};

/** An entry that waits because its tournament is outside the allowed lobbies. */
export type TournamentRequest = {
  readonly back: { readonly label: string; readonly href: string };
  readonly title: string;
  readonly lede: string;
  readonly facts: readonly {
    readonly title: string;
    readonly detail: string;
  }[];
  readonly consequence: { readonly allows: string; readonly keeps: string };
  readonly allow: TabAction;
  readonly decline: TabAction;
  readonly declineNote: string;
};

export const readMinorAccount = (
  minor: string,
  scene: SampleScene,
): MinorAccount | null => sampleMinorAccount(minor, scene);

export const readTournamentRequest = (
  minor: string,
  slug: string,
  scene: SampleScene,
): TournamentRequest | null => sampleTournamentRequest(minor, slug, scene);
