import {
  outsideControlLapses,
  type ControlLapse,
  type HoldEntry,
} from '@daisy/protocol';

/**
 * Which held media of one attempt to build from. The whole file is written only
 * when an Egress finishes cleanly, so a crashed attempt has its segments and no
 * file. Segments stop at the first one missing: what follows has no place.
 */
export type AttemptSource =
  | { readonly kind: 'whole_file'; readonly startedAtMs: number }
  | {
      readonly kind: 'segments';
      readonly startedAtMs: number;
      readonly entries: readonly HoldEntry[];
    }
  | { readonly kind: 'absent' };

export const WHOLE_FILE = 'full.mp4';
export const HOLD_PLAYLIST = 'p.m3u8';

export const segmentsSource = (
  entries: readonly HoldEntry[],
  heldNames: ReadonlySet<string>,
): AttemptSource => {
  const stop = entries.findIndex((entry) => !heldNames.has(entry.name));
  const present = stop === -1 ? entries : entries.slice(0, stop);
  const [first] = present;
  return first
    ? { kind: 'segments', startedAtMs: first.capturedAtMs, entries: present }
    : { kind: 'absent' };
};

/**
 * What of one attempt may be built when lapses touch it: each unbroken run of what
 * lies outside them. The whole file is never used then, since it holds the lapse.
 */
export const runsOutsideLapses = (
  entries: readonly HoldEntry[],
  heldNames: ReadonlySet<string>,
  lapses: readonly ControlLapse[],
): readonly AttemptSource[] => {
  const kept = new Set(outsideControlLapses(entries, lapses));
  const runs: HoldEntry[][] = [];
  let open = false;
  for (const entry of entries) {
    if (!kept.has(entry)) open = false;
    else if (open) runs.at(-1)!.push(entry);
    else {
      runs.push([entry]);
      open = true;
    }
  }
  return runs
    .map((run) => segmentsSource(run, heldNames))
    .filter((source) => source.kind !== 'absent');
};

/** Media with no capture time has no honest place in the timeline, so it is left out. */
export const attemptSource = (
  entries: readonly HoldEntry[],
  heldNames: ReadonlySet<string>,
): AttemptSource => {
  const [first] = entries;
  if (!first) return { kind: 'absent' };
  return heldNames.has(WHOLE_FILE)
    ? { kind: 'whole_file', startedAtMs: first.capturedAtMs }
    : segmentsSource(entries, heldNames);
};
