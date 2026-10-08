import type { Block, Speech } from './case';

export type WordSegment = {
  readonly kind: 'keep' | 'del' | 'ins';
  readonly text: string;
};

export type Change =
  | { readonly op: 'add'; readonly title: string; readonly detail: string }
  | { readonly op: 'remove'; readonly title: string; readonly detail: string }
  | { readonly op: 'move'; readonly title: string; readonly detail: string }
  | {
      readonly op: 'edit';
      readonly title: string;
      readonly segments: readonly WordSegment[];
    };

type ChangeGroup = {
  readonly speech: string;
  readonly changes: readonly Change[];
};

export type Diff = {
  readonly counts: Readonly<Record<Change['op'], number>>;
  readonly total: number;
  readonly groups: readonly ChangeGroup[];
};

/** Longest common subsequence of two token lists, as index pairs. */
function commonPairs(a: readonly string[], b: readonly string[]) {
  const table = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const pairs: { i: number; j: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push({ i, j });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

/** Word-level difference: words only in `from` are deleted, only in `to` inserted. */
export function wordDiff(from: string, to: string): readonly WordSegment[] {
  const a = from.split(/\s+/).filter(Boolean);
  const b = to.split(/\s+/).filter(Boolean);
  const out: { kind: WordSegment['kind']; words: string[] }[] = [];
  const push = (kind: WordSegment['kind'], word: string) => {
    const last = out.at(-1);
    if (last?.kind === kind) last.words.push(word);
    else out.push({ kind, words: [word] });
  };
  let i = 0;
  let j = 0;
  for (const pair of [...commonPairs(a, b), { i: a.length, j: b.length }]) {
    while (i < pair.i) push('del', a[i++]!);
    while (j < pair.j) push('ins', b[j++]!);
    if (pair.i < a.length) {
      push('keep', a[pair.i]!);
      i = pair.i + 1;
      j = pair.j + 1;
    }
  }
  return out.map((run, index) => ({
    kind: run.kind,
    text: `${index > 0 ? ' ' : ''}${run.words.join(' ')}`,
  }));
}

const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const place = (index: number): string =>
  ordinals[index] ?? `number ${index + 1}`;

/**
 * Blocks outside the longest run that kept their relative order: those are
 * the ones that moved. On a tie the earlier block in `from` is the one kept.
 */
function movedIds(
  common: readonly string[],
  target: readonly string[],
): ReadonlySet<string> {
  const toIndex = common.map((id) => target.indexOf(id));
  const length = toIndex.map(() => 1);
  const previous = toIndex.map(() => -1);
  toIndex.forEach((position, i) => {
    for (let k = 0; k < i; k += 1)
      if (toIndex[k]! < position && length[k]! + 1 > length[i]!) {
        length[i] = length[k]! + 1;
        previous[i] = k;
      }
  });
  let end = 0;
  length.forEach((value, i) => {
    if (value > length[end]!) end = i;
  });
  const kept = new Set<number>();
  for (let i = common.length > 0 ? end : -1; i >= 0; i = previous[i]!)
    kept.add(i);
  return new Set(common.filter((_, index) => !kept.has(index)));
}

const speechOf = (speeches: readonly Speech[], id: string) =>
  speeches.find((speech) => speech.blocks.some((block) => block.id === id));

const labelOf = (speeches: readonly Speech[], id: string): string =>
  speechOf(speeches, id)?.label ?? 'another speech';

/** The changes inside one speech slot, in the order they read. */
function speechChanges(
  label: string,
  from: readonly Speech[],
  to: readonly Speech[],
  fromIds: ReadonlySet<string>,
  toIds: ReadonlySet<string>,
): readonly Change[] {
  const before = from.find((s) => s.label === label)?.blocks ?? [];
  const after = to.find((s) => s.label === label)?.blocks ?? [];
  const common = before.filter((b) => after.some((x) => x.id === b.id));
  const moved = movedIds(
    common.map((b) => b.id),
    after.filter((b) => before.some((x) => x.id === b.id)).map((b) => b.id),
  );
  const changes: Change[] = [];
  for (const [index, block] of after.entries()) {
    const change = blockChange({
      block,
      index,
      before,
      after,
      from,
      fromIds,
      moved,
    });
    if (change !== null) changes.push(change);
  }
  for (const block of before)
    if (!toIds.has(block.id))
      changes.push({ op: 'remove', title: block.title, detail: 'Removed' });
  return changes;
}

function blockChange(args: {
  readonly block: Block;
  readonly index: number;
  readonly before: readonly Block[];
  readonly after: readonly Block[];
  readonly from: readonly Speech[];
  readonly fromIds: ReadonlySet<string>;
  readonly moved: ReadonlySet<string>;
}): Change | null {
  const { block, index, before, after, from, fromIds, moved } = args;
  if (!fromIds.has(block.id)) {
    const prior = after[index - 1];
    return {
      op: 'add',
      title: block.title,
      detail: `Added${prior === undefined ? ' at the start' : ` after ${prior.title}`} · ${block.sub}`,
    };
  }
  if (!before.some((b) => b.id === block.id))
    return {
      op: 'move',
      title: `${block.title} moved`,
      detail: `Moved here from ${labelOf(from, block.id)}`,
    };
  if (moved.has(block.id))
    return {
      op: 'move',
      title: `${block.title} moved`,
      detail: `Now ${place(index)} in the speech, was ${place(before.findIndex((b) => b.id === block.id))}`,
    };
  const old = findBlock(from, block.id);
  if (old?.text !== block.text && block.text !== undefined)
    return {
      op: 'edit',
      title: `${block.title}, claim`,
      segments: wordDiff(old?.text ?? '', block.text),
    };
  return null;
}

/**
 * What changed between two snapshots of a case: blocks added, removed, moved
 * within or between speeches, and edited (word by word). Blocks are matched
 * by id.
 */
export function diffCases(
  from: readonly Speech[],
  to: readonly Speech[],
): Diff {
  const fromIds = new Set(from.flatMap((s) => s.blocks.map((b) => b.id)));
  const toIds = new Set(to.flatMap((s) => s.blocks.map((b) => b.id)));
  const labels = [
    ...new Set([...to.map((s) => s.label), ...from.map((s) => s.label)]),
  ];
  const groups = labels
    .map((speech) => ({
      speech,
      changes: speechChanges(speech, from, to, fromIds, toIds),
    }))
    .filter((group) => group.changes.length > 0);
  const all = groups.flatMap((g) => g.changes);
  const count = (op: Change['op']) => all.filter((c) => c.op === op).length;
  return {
    counts: {
      add: count('add'),
      remove: count('remove'),
      move: count('move'),
      edit: count('edit'),
    },
    total: all.length,
    groups,
  };
}

const findBlock = (
  speeches: readonly Speech[],
  id: string,
): Block | undefined => speechOf(speeches, id)?.blocks.find((b) => b.id === id);
