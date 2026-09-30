import type { Visibility } from './library-item';
import { wordCount } from './reading-time';

/**
 * A layer over the source text. The text itself is never edited: a card keeps
 * the original words and marks which stretches are read aloud, kept, or
 * plain context.
 */
type SegmentKind = 'context' | 'read' | 'keep';
export type Segment = { readonly kind: SegmentKind; readonly text: string };

export type CardVersion = {
  readonly version: number;
  readonly label: string;
  readonly when: string;
  readonly tags: readonly string[];
  readonly segments: readonly Segment[];
};

export type CardUse = {
  readonly title: string;
  readonly detail: string;
  readonly href: string;
};

export type Card = {
  readonly id: string;
  readonly tagLine: string;
  readonly author: string;
  readonly year: string;
  readonly qualifications: string;
  readonly publication: string;
  readonly title: string;
  /** Empty when the source gave none; the card then shows an amber mark. */
  readonly published: string;
  readonly url: string;
  readonly retrieved: string;
  readonly credibilityNotes: string;
  readonly visibility: Visibility;
  readonly uses: readonly CardUse[];
  /** Newest first; the first is current. */
  readonly versions: readonly CardVersion[];
};

export const currentVersion = (card: Card): CardVersion => {
  const [latest] = card.versions;
  if (latest === undefined) throw new Error(`card ${card.id} has no version`);
  return latest;
};

export const readWords = (segments: readonly Segment[]): number =>
  segments
    .filter((segment) => segment.kind === 'read')
    .reduce((total, segment) => total + wordCount(segment.text), 0);

/** The read-aloud passages with an ellipsis where context was cut. */
export const readView = (segments: readonly Segment[]): readonly Segment[] =>
  segments.flatMap((segment, index) =>
    segment.kind === 'read'
      ? [
          ...(index > 0 ? [{ kind: 'context' as const, text: '…' }] : []),
          segment,
          ...(index < segments.length - 1
            ? [{ kind: 'context' as const, text: '…' }]
            : []),
        ]
      : [],
  );

/** The fields whose absence dims a citation; each has a display name. */
const tracked = [
  ['author', 'author'],
  ['qualifications', 'qualifications'],
  ['publication', 'publication'],
  ['title', 'title'],
  ['published', 'publication date'],
  ['url', 'link'],
  ['credibilityNotes', 'credibility note'],
] as const;

export type CitationFields = Pick<
  Card,
  | 'author'
  | 'qualifications'
  | 'publication'
  | 'title'
  | 'published'
  | 'url'
  | 'credibilityNotes'
>;

export type Completeness = {
  readonly filled: number;
  readonly total: number;
  readonly percent: number;
  readonly missing: readonly string[];
};

/** How many of the seven citation fields are filled, and which are not. */
export function citationCompleteness(fields: CitationFields): Completeness {
  const missing = tracked
    .filter(([key]) => fields[key].trim() === '')
    .map(([, name]) => name);
  const total = tracked.length;
  const filled = total - missing.length;
  return {
    filled,
    total,
    percent: Math.round((filled / total) * 100),
    missing,
  };
}
