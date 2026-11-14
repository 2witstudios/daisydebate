import type { TabAction } from './action';
import type { EventSwitch } from './setup';
import {
  sampleHostEntries,
  sampleHostJudges,
  sampleSchoolEntries,
} from './sample/entries';
import type { SampleScene } from './sample/scene';

export type EntryStatus = 'accepted' | 'not_answered';

export type HostEntryRow = {
  readonly name: string;
  readonly facts: string;
  readonly status: EntryStatus;
};

/** The entries one responsible adult answers for. */
export type EntryGroup = {
  readonly name: string;
  readonly enteredBy: string | null;
  readonly summary: string;
  /** Whether the group still owes judges. */
  readonly short: boolean;
  readonly entries: readonly HostEntryRow[];
  readonly more: TabAction | null;
};

export type EntriesTabs = {
  readonly debaters: number;
  readonly judges: number;
};

export type HostEntries = {
  readonly event: EventSwitch;
  readonly lede: string;
  readonly actions: readonly TabAction[];
  readonly tabs: EntriesTabs;
  readonly groups: readonly EntryGroup[];
  readonly note: string;
};

export type JudgeSlotState =
  'judged' | 'away' | 'free' | 'in_draft' | 'room' | 'late';

export type TournamentJudgeRow = {
  readonly name: string;
  /** One cell per time slot, in the columns' order. */
  readonly slots: readonly {
    readonly state: JudgeSlotState;
    readonly label: string;
  }[];
  readonly clearedFor: string;
  readonly judged: number;
  readonly neverJudges: string;
  /** A conflict that holds in every event, such as a judge's own children. */
  readonly conflict: boolean;
};

export type JudgeGroup = {
  readonly name: string;
  readonly summary: string;
  readonly remind: TabAction | null;
  readonly judges: readonly TournamentJudgeRow[];
};

export type HostJudges = {
  readonly lede: string;
  readonly add: TabAction;
  readonly tabs: EntriesTabs;
  readonly slots: readonly string[];
  readonly groups: readonly JudgeGroup[];
  readonly more: TabAction | null;
};

export type SchoolStudent = {
  readonly name: string;
  readonly note: string | null;
  readonly events: string;
  /** What stops this student's entries being submitted. */
  readonly problem: string | null;
  readonly edit: TabAction;
};

/** A responsible adult's own entries at one tournament. */
export type SchoolEntries = {
  readonly tournament: { readonly name: string; readonly href: string };
  readonly title: string;
  readonly lede: string;
  readonly students: readonly SchoolStudent[];
  readonly add: TabAction;
  readonly judges: {
    readonly title: string;
    readonly detail: string;
    readonly add: TabAction;
  };
  readonly submit: {
    readonly label: string;
    readonly blocked: boolean;
    readonly note: string;
  };
};

export const readHostEntries = (
  slug: string,
  scene: SampleScene,
): HostEntries | null => sampleHostEntries(slug, scene);

export const readHostJudges = (
  slug: string,
  scene: SampleScene,
): HostJudges | null => sampleHostJudges(slug, scene);

export const readSchoolEntries = (
  slug: string,
  scene: SampleScene,
): SchoolEntries | null => sampleSchoolEntries(slug, scene);
