import { formatClock as formatSeconds } from '../judge/clock';
import { formatClock } from './clock';

type Attrs = Readonly<Record<string, unknown>>;

/** A Tiptap-compatible JSON node, described without importing Tiptap. */
export type DocJSON = {
  readonly type: string;
  readonly attrs?: Attrs;
  readonly content?: readonly DocJSON[];
  readonly text?: string;
  readonly marks?: readonly { readonly type: string; readonly attrs?: Attrs }[];
};

export type DebateMark = 'aff' | 'neg' | 'extend' | 'dropped' | 'new';
export const debateMarks: readonly DebateMark[] = [
  'aff',
  'neg',
  'extend',
  'dropped',
  'new',
];

export type Side = 'aff' | 'neg';

export type SpeechSlot = {
  readonly id: string;
  readonly code: string;
  readonly side: Side;
  readonly kind: 'speech' | 'cross-ex';
  readonly durationMs: number;
};

export type TemplateId =
  'blank' | 'flow' | 'cross-ex' | 'speech-plan' | 'case' | 'block' | 'evidence';

export type DocumentTemplate = {
  readonly id: TemplateId;
  readonly title: string;
  readonly keywords: readonly string[];
};

export const documentTemplates: readonly DocumentTemplate[] = [
  { id: 'blank', title: 'Blank document', keywords: ['empty', 'note'] },
  { id: 'flow', title: 'Flow', keywords: ['notes', 'sheet', 'arguments'] },
  { id: 'cross-ex', title: 'Cross-ex notes', keywords: ['questions', 'cx'] },
  { id: 'speech-plan', title: 'Speech plan', keywords: ['outline', 'timing'] },
  { id: 'case', title: 'Case', keywords: ['constructive', 'contentions'] },
  { id: 'block', title: 'Block', keywords: ['answers', 'responses'] },
  { id: 'evidence', title: 'Evidence', keywords: ['card', 'quote', 'source'] },
];

export type TemplateContext = {
  readonly side: Side;
  readonly speeches: readonly SpeechSlot[];
  readonly title: string;
  /** The speech the round has reached; plans start after it. */
  readonly currentIndex?: number;
};

const text = (value: string): DocJSON => ({ type: 'text', text: value });
const paragraph = (value = ''): DocJSON =>
  value === ''
    ? { type: 'paragraph' }
    : { type: 'paragraph', content: [text(value)] };
const heading = (level: number, value: string): DocJSON => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const bulletList = (items: readonly string[] = ['']): DocJSON => ({
  type: 'bulletList',
  content: items.map((item) => ({
    type: 'listItem',
    content: [paragraph(item)],
  })),
});
const taskList = (): DocJSON => ({
  type: 'taskList',
  content: [
    { type: 'taskItem', attrs: { checked: false }, content: [paragraph()] },
  ],
});
const doc = (content: readonly DocJSON[]): DocJSON => ({
  type: 'doc',
  content,
});

const sideLabel: Readonly<Record<Side, string>> = { aff: 'Aff', neg: 'Neg' };

const titleOf = (id: TemplateId, context: TemplateContext) =>
  context.title.trim() ||
  (documentTemplates.find((t) => t.id === id)?.title ?? 'Untitled');

function flowTemplate(context: TemplateContext): DocJSON {
  const sections = context.speeches
    .filter((slot) => slot.kind === 'speech')
    .flatMap((slot) => {
      const you = slot.side === context.side ? ' · You' : '';
      return [
        heading(2, `${slot.code} · ${sideLabel[slot.side]}${you}`),
        bulletList(),
      ];
    });
  return doc([heading(1, titleOf('flow', context)), ...sections]);
}

function crossExTemplate(context: TemplateContext): DocJSON {
  return doc([
    heading(1, titleOf('cross-ex', context)),
    heading(2, 'Questions'),
    taskList(),
    heading(2, 'Admissions'),
    bulletList(),
  ]);
}

const planRows = [
  { share: 0, label: 'Overview' },
  { share: 0.15, label: 'Line by line' },
  { share: 0.8, label: 'Voters' },
] as const;

function speechPlanTemplate(context: TemplateContext): DocJSON {
  const next = nextOwnSpeech(
    context.speeches,
    context.side,
    context.currentIndex ?? -1,
  );
  const title = titleOf('speech-plan', context);
  if (next === null) return doc([heading(1, title), bulletList()]);
  const rows = planRows.map(
    (row) =>
      `${formatSeconds((next.durationMs * row.share) / 1000)} ${row.label}`,
  );
  return doc([
    heading(1, title),
    heading(2, `${next.code} · ${formatClock(next.durationMs)}`),
    bulletList(rows),
  ]);
}

/** A template's starting content as a 'doc' node. */
export function buildTemplate(
  id: TemplateId,
  context: TemplateContext,
): DocJSON {
  if (id === 'flow') return flowTemplate(context);
  if (id === 'cross-ex') return crossExTemplate(context);
  if (id === 'speech-plan') return speechPlanTemplate(context);
  return doc([heading(1, titleOf(id, context)), paragraph()]);
}

export type FolderId = 'round' | 'library' | 'club';

export type WorkspaceDocument = {
  readonly id: string;
  readonly title: string;
  readonly folder: FolderId;
  readonly templateId: TemplateId;
  readonly content: DocJSON;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** "Flow", then "Flow 2", "Flow 3"… for the first title not already taken. */
export function uniqueTitle(base: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function createDocument(input: {
  readonly id: string;
  readonly now: string;
  readonly folder: FolderId;
  readonly templateId: TemplateId;
  readonly title?: string;
  readonly existingTitles: readonly string[];
  readonly context: TemplateContext;
}): WorkspaceDocument {
  const base =
    input.title?.trim() ||
    titleOf(input.templateId, { ...input.context, title: '' });
  const title = uniqueTitle(base, input.existingTitles);
  return {
    id: input.id,
    title,
    folder: input.folder,
    templateId: input.templateId,
    content: buildTemplate(input.templateId, { ...input.context, title }),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function updateDocumentContent(
  document: WorkspaceDocument,
  content: DocJSON,
  now: string,
): WorkspaceDocument {
  return { ...document, content, updatedAt: now };
}

export function renameDocument(
  document: WorkspaceDocument,
  title: string,
  now: string,
): WorkspaceDocument {
  const trimmed = title.trim();
  if (trimmed === '' || trimmed === document.title) return document;
  return { ...document, title: trimmed, updatedAt: now };
}

/** The side's next speech (not cross-ex) after currentIndex, or null. */
export function nextOwnSpeech(
  speeches: readonly SpeechSlot[],
  side: Side,
  currentIndex: number,
): SpeechSlot | null {
  return (
    speeches.find(
      (slot, index) =>
        index > currentIndex && slot.side === side && slot.kind === 'speech',
    ) ?? null
  );
}
