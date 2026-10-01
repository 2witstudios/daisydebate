import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import {
  briefTime,
  contentionWords,
  framingWords,
  responseCount,
  type Brief,
  type BriefResponse,
  type BriefTime,
  type Contention,
} from './brief';
import { sideLabel } from './library-item';
import {
  budget,
  formatClock,
  wordCount,
  readSeconds,
  type Budget,
} from './reading-time';

export type BriefEditorQuery = { readonly section: string };

const schema = z.object({
  section: z
    .string()
    .regex(/^[a-z0-9]{1,12}$/)
    .catch(''),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the editor's URL state; an unknown section resolves in the view. */
export function parseBriefEditorQuery(params: SearchParams): BriefEditorQuery {
  return schema.parse({ section: first(params['section']) });
}

export const briefHref = (id: string, section: string): string =>
  section === ''
    ? `/prep/briefs/${id}`
    : `/prep/briefs/${id}?section=${section}`;

type OutlineItem = {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly href: string;
  readonly current: boolean;
  /** Contentions carry a drag handle in the desktop outline. */
  readonly reorderable: boolean;
};

type EditorSection =
  | { readonly kind: 'framing'; readonly words: number; readonly clock: string }
  | {
      readonly kind: 'contention';
      readonly number: number;
      readonly contention: Contention;
      readonly words: number;
      readonly clock: string;
      readonly claimWords: number;
      readonly warrantWords: number;
      readonly impactWords: number;
      readonly own: Budget & { readonly spareClock: string };
    }
  | {
      readonly kind: 'responses';
      readonly groups: readonly {
        readonly label: string;
        readonly responses: readonly BriefResponse[];
      }[];
    };

export type BriefEditorView = {
  readonly brief: Brief;
  readonly sideLabel: string;
  readonly savedLabel: string;
  readonly outline: readonly OutlineItem[];
  readonly section: EditorSection;
  readonly time: BriefTime;
  readonly paceLabel: string;
  readonly reviewHref: string;
  readonly shareHref: string;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function resolveSection(brief: Brief, asked: string): string {
  const known = ['framing', 'responses', ...brief.contentions.map((c) => c.id)];
  if (known.includes(asked)) return asked;
  return brief.id === 'new'
    ? 'framing'
    : (brief.contentions[0]?.id ?? 'framing');
}

/** The editor's one driver: a brief and the URL state to a view model. */
export function briefEditorView(
  brief: Brief,
  query: BriefEditorQuery,
  pace: number,
  limitSeconds: number,
): BriefEditorView {
  const current = resolveSection(brief, query.section);
  const time = briefTime(brief, pace, limitSeconds);
  const item = (
    id: string,
    label: string,
    detail: string,
    reorderable: boolean,
  ): OutlineItem => ({
    id,
    label,
    detail,
    href: briefHref(brief.id, id),
    current: id === current,
    reorderable,
  });
  const outline = [
    item(
      'framing',
      'Motion and framing',
      plural(framingWords(brief), 'word'),
      false,
    ),
    ...brief.contentions.map((c, index) =>
      item(
        c.id,
        `${index + 1}  ${c.tag === '' ? 'Untitled contention' : c.tag}`,
        `${plural(contentionWords(c), 'word')} · ${plural(c.cards.length, 'card')}`,
        true,
      ),
    ),
    item(
      'responses',
      'Anticipated responses',
      plural(responseCount(brief), 'response'),
      false,
    ),
  ];
  const index = brief.contentions.findIndex((c) => c.id === current);
  const contention = brief.contentions[index];
  let section: EditorSection;
  if (contention !== undefined) {
    const words = contentionWords(contention);
    const seconds = readSeconds(words, pace);
    const own = budget(seconds, limitSeconds);
    section = {
      kind: 'contention',
      number: index + 1,
      contention,
      words,
      clock: formatClock(seconds),
      claimWords: wordCount(contention.claim),
      warrantWords: wordCount(contention.warrant),
      impactWords: wordCount(contention.impact),
      own: {
        ...own,
        spareClock: formatClock(own.over ? 0 : limitSeconds - seconds),
      },
    };
  } else if (current === 'responses') {
    section = {
      kind: 'responses',
      groups: brief.contentions
        .filter((c) => c.responses.length > 0)
        .map((c) => ({
          label: `Contention ${brief.contentions.indexOf(c) + 1}`,
          responses: c.responses,
        })),
    };
  } else {
    section = {
      kind: 'framing',
      words: framingWords(brief),
      clock: time.sections[0]?.clock ?? '0:00',
    };
  }
  return {
    brief,
    sideLabel: sideLabel(brief.side),
    savedLabel:
      brief.savedAt === '' ? 'Not saved yet' : `Last saved ${brief.savedAt}`,
    outline,
    section,
    time,
    paceLabel: `[${pace}]`,
    reviewHref: `/prep/briefs/${brief.id}/review`,
    shareHref: `/prep/briefs/${brief.id}/review?share=open`,
  };
}
