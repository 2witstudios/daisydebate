import type { HoldEntry } from '@daisy/protocol';

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

/** A hole this wide, left by stripping a failed source, is not one continuous piece. */
const CONTINUOUS_WITHIN_MS = 500;

/** Held entries split where their capture times stop following on. */
export const continuousRuns = (
  entries: readonly HoldEntry[],
): readonly (readonly HoldEntry[])[] => {
  const runs: HoldEntry[][] = [];
  for (const entry of entries) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (
      run &&
      last &&
      entry.capturedAtMs - (last.capturedAtMs + last.durationMs) <=
        CONTINUOUS_WITHIN_MS
    )
      run.push(entry);
    else runs.push([entry]);
  }
  return runs;
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
