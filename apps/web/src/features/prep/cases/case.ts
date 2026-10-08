import type { Side, Visibility } from '../library/library-item';
import { budget, formatClock, readSeconds, type Budget } from '../reading-time';

/**
 * A block of a speech: a brief section, a card, or a private transition note.
 * `words` are the spoken words it adds; `text` is the line a version compare
 * follows word by word (a contention's claim).
 */
type BlockKind = 'brief' | 'card' | 'note';

export type Block = {
  readonly id: string;
  readonly kind: BlockKind;
  readonly title: string;
  readonly sub: string;
  readonly words: number;
  readonly text?: string;
  /** The claim shown in the in-debate panel when this block is next. */
  readonly claim?: string;
  /** The card this block showed was deleted; the slot is kept. */
  readonly removed?: boolean;
  /** Where the block opens (a card or a brief), when it has a home. */
  readonly href?: string;
};

/** A speech slot. Labels are placeholders: the debate's real speeches are not decided. */
export type Speech = {
  readonly id: string;
  readonly label: string;
  readonly blocks: readonly Block[];
};

export type CaseVersion = {
  readonly version: number;
  readonly note: string;
  readonly when: string;
  readonly speeches: readonly Speech[];
};

export type Case = {
  readonly id: string;
  readonly title: string;
  readonly motion: string;
  readonly side: Side;
  readonly visibility: Visibility;
  /** "can comment" for a shared case; empty when private. */
  readonly sharedRight: string;
  /** Saved versions, newest first. */
  readonly versions: readonly CaseVersion[];
  /** The working draft on top of the newest saved version, if it differs. */
  readonly draft: {
    readonly since: string;
    readonly speeches: readonly Speech[];
  } | null;
};

export const latestVersion = (c: Case): CaseVersion => {
  const [latest] = c.versions;
  if (latest === undefined) throw new Error(`case ${c.id} has no version`);
  return latest;
};

/** The speeches on screen: the draft when there is one, else the newest version. */
export const workingSpeeches = (c: Case): readonly Speech[] =>
  c.draft?.speeches ?? latestVersion(c).speeches;

export type SpeechTime = {
  readonly seconds: number;
  readonly clock: string;
  readonly budget: Budget;
  readonly overClock: string;
};

export function speechTime(
  speech: Speech,
  pace: number,
  limitSeconds: number,
): SpeechTime {
  const seconds = speech.blocks.reduce(
    (total, b) => total + readSeconds(b.words, pace),
    0,
  );
  const result = budget(seconds, limitSeconds);
  return {
    seconds,
    clock: formatClock(seconds),
    budget: result,
    overClock: formatClock(result.over ? result.deltaSeconds : 0),
  };
}

export const blockClock = (block: Block, pace: number): string =>
  formatClock(readSeconds(block.words, pace));
