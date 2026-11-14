import type { TabAction } from './action';
import {
  sampleHostHome,
  sampleHostRail,
  samplePeople,
} from './sample/organization';
import type { TimelineRail } from './tournament';
import type { SampleScene } from './sample/scene';

export type HostTournamentRow = {
  readonly name: string;
  readonly owner: string;
  readonly detail: string;
  readonly action: TabAction;
};

/** Everything the viewer holds a grant on. */
export type HostHome = {
  readonly create: TabAction;
  readonly groups: readonly {
    readonly heading: string;
    readonly tournaments: readonly HostTournamentRow[];
  }[];
  readonly cards: readonly {
    readonly title: string;
    readonly detail: string;
    readonly action: TabAction;
  }[];
};

/** A member with the grants they hold, or the owner's fixed position. */
export type PersonRow = {
  readonly name: string;
  readonly detail: string;
  /** A conflict the evaluator has recorded for this person. */
  readonly conflict: string | null;
  readonly owner: boolean;
  readonly action: TabAction | null;
};

/** One of Daisy's preset roles: a named set of permissions. */
export type PresetRole = {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly selected: boolean;
};

export type People = {
  readonly give: TabAction;
  readonly people: readonly PersonRow[];
  readonly roles: readonly PresetRole[];
  readonly role: {
    readonly name: string;
    readonly permissions: readonly {
      readonly label: string;
      readonly allowed: boolean;
    }[];
    readonly conflictRule: string;
  };
};

export const readHostHome = (scene: SampleScene): HostHome =>
  sampleHostHome(scene);

export const readPeople = (
  role: string | null,
  basePath: string,
  scene: SampleScene,
): People => samplePeople(role, basePath, scene);

export const readHostRail = (scene: SampleScene): TimelineRail =>
  sampleHostRail(scene);
