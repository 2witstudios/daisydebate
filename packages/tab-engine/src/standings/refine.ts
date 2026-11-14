import type { Id } from '../shapes/competition';
import type { Rational, StandingsRow } from '../shapes/folds';
import type { Metric } from '../shapes/settings';
import { drawLots } from './lot';
import { compareVector } from './rational';

type Separator = StandingsRow['separatedBy'];

/** A run of entries still tied; `separatedBy` is what put its first entry below the run above. */
type Block = {
  readonly entries: readonly Id[];
  readonly separatedBy: Separator;
};

export type Ordered = { readonly entry: Id; readonly separatedBy: Separator };

type Refinement = {
  readonly metrics: readonly Metric[];
  readonly valueOf: (entry: Id, metric: Metric) => readonly Rational[];
  readonly lowerIsBetter: (metric: Metric) => boolean;
  readonly meetings: (
    entry: Id,
    other: Id,
  ) => { readonly met: boolean; readonly won: number };
  readonly terminal: 'lot' | 'shared';
  readonly seed: Uint8Array;
};

const splitBy = (block: Block, metric: Metric, r: Refinement): Block[] => {
  const sign = r.lowerIsBetter(metric) ? 1 : -1;
  const keyed = block.entries.map((entry) => ({
    entry,
    value: r.valueOf(entry, metric),
  }));
  const sorted = [...keyed].sort(
    (a, b) => sign * compareVector(a.value, b.value),
  );
  const out: { entries: Id[]; separatedBy: Separator }[] = [];
  sorted.forEach((item, i) => {
    if (i > 0 && compareVector(sorted[i - 1]!.value, item.value) === 0)
      out[out.length - 1]!.entries.push(item.entry);
    else
      out.push({
        entries: [item.entry],
        separatedBy: i === 0 ? block.separatedBy : metric,
      });
  });
  return out;
};

/** Head to head separates only a pair who met, by who won more of their meetings. */
const splitHeadToHead = (
  block: Block,
  r: Refinement,
  values: Map<Id, readonly Rational[]>,
) => {
  if (block.entries.length !== 2) return [block];
  const [a, b] = block.entries as [Id, Id];
  const ofA = r.meetings(a, b);
  const ofB = r.meetings(b, a);
  if (!ofA.met) return [block];
  values.set(a, [{ n: ofA.won, d: 1 }]);
  values.set(b, [{ n: ofB.won, d: 1 }]);
  if (ofA.won === ofB.won) return [block];
  const [first, second] = ofA.won > ofB.won ? [a, b] : [b, a];
  return [
    { entries: [first], separatedBy: block.separatedBy },
    { entries: [second], separatedBy: 'head_to_head' as const },
  ];
};

const settle = (block: Block, r: Refinement): Ordered[] => {
  const entries =
    r.terminal === 'lot' && block.entries.length > 1
      ? drawLots('daisy-tab-v1/standings/lot', r.seed, block.entries)
      : block.entries;
  return entries.map((entry, i) => ({
    entry,
    separatedBy: i === 0 ? block.separatedBy : r.terminal,
  }));
};

/**
 * Partition refinement: one block of everyone, split by each metric in
 * turn, each split confined to the block it refines. What is still tied at
 * the end goes to the terminal rule. Entries arrive in canonical order, so
 * the sort's stability never depends on the caller's order.
 */
export const refine = (
  entries: readonly Id[],
  first: Separator,
  r: Refinement,
): {
  readonly order: readonly Ordered[];
  readonly headToHead: ReadonlyMap<Id, readonly Rational[]>;
} => {
  const headToHead = new Map<Id, readonly Rational[]>();
  let blocks: Block[] =
    entries.length === 0 ? [] : [{ entries, separatedBy: first }];
  for (const metric of r.metrics)
    blocks = blocks.flatMap((block) =>
      block.entries.length < 2
        ? [block]
        : metric === 'head_to_head'
          ? splitHeadToHead(block, r, headToHead)
          : splitBy(block, metric, r),
    );
  return { order: blocks.flatMap((block) => settle(block, r)), headToHead };
};
