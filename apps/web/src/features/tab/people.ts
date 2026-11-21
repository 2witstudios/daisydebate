import type { TabAction } from './action';

/** A member with the grants they hold, or the owner's fixed position. */
export type PersonRow<Command = never> = {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  /** A conflict the evaluator has recorded for this person. */
  readonly conflict: string | null;
  readonly owner: boolean;
  readonly action: TabAction<Command> | null;
};

/** One of Daisy's preset roles: a named set of permissions. */
type PresetRole = {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly selected: boolean;
};

export type People<Command = never> = {
  readonly give: TabAction<Command> | null;
  readonly people: readonly PersonRow<Command>[];
  readonly roles: readonly PresetRole[];
  readonly role: {
    readonly preset: boolean;
    readonly name: string;
    readonly permissions: readonly {
      readonly label: string;
      readonly allowed: boolean;
    }[];
    readonly conflictRule: string;
  };
};
