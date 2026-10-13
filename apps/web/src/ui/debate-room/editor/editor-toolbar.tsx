'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import { useRef, useState, type KeyboardEvent } from 'react';
import {
  debateMarks,
  type DebateMark,
} from '../../../features/debate-room/documents/documents';
import {
  pageColumnChoices,
  pageLayoutOf,
  parsePageColumns,
  portrait,
  type PageLayout,
} from '../../../features/debate-room/documents/page-layout';
import { cn } from '../../cn';
import { Icon, type IconName } from '../../components/icon/icon';
import type { PageTone } from '../room-state';
import {
  stepTextSize,
  textSizes,
  toolbarFocus,
  type TextSize,
} from './editor-view';

const markNames: Readonly<Record<DebateMark, string>> = {
  aff: 'Aff',
  neg: 'Neg',
  extend: 'Extend',
  dropped: 'Dropped',
  new: 'New',
};

const markTone: Readonly<Record<DebateMark, string>> = {
  aff: 'bg-hue-sky-soft text-hue-sky',
  neg: 'bg-hue-clay-soft text-hue-clay',
  extend: 'bg-hue-teal-soft text-hue-teal',
  dropped: 'bg-live-soft text-ink line-through decoration-live decoration-2',
  new: 'bg-gold-soft text-gold',
};

type Format = {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly run: (editor: Editor) => void;
};

const formats: readonly Format[] = [
  {
    id: 'bold',
    label: 'Bold',
    icon: 'bold',
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    id: 'italic',
    label: 'Italic',
    icon: 'italic',
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: 'heading',
    label: 'Heading',
    icon: 'heading',
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'bulletList',
    label: 'Bulleted list',
    icon: 'list',
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'taskList',
    label: 'Checklist',
    icon: 'checklist',
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
];

const toneIcon = { dark: 'moon', light: 'sun' } as const;

const tool = (on: boolean) =>
  cn(
    'flex size-room-target shrink-0 cursor-pointer items-center justify-center rounded-sm transition-colors',
    on ? 'bg-surface-overlay text-ink' : 'text-ink-muted hover:text-ink',
  );

/** Formats then marks, in the toolbar's focus order. */
const toolCount = formats.length + debateMarks.length;

const layoutValue = (layout: PageLayout) =>
  layout.orientation === 'portrait' ? 'portrait' : String(layout.columns);

const layoutFrom = (value: string): PageLayout => {
  const columns = parsePageColumns(value);
  return columns === null ? portrait : { orientation: 'landscape', columns };
};

type Props = {
  readonly editor: Editor;
  readonly access: string;
  readonly page: PageTone;
  readonly onPage: (tone: PageTone) => void;
  readonly textSize: TextSize;
  readonly onTextSize: (size: TextSize) => void;
};

/**
 * Formatting and the five debate marks as one toolbar (one tab stop, arrow
 * keys within it), then who can read the file, its page layout, the view's
 * text size and the page tone.
 */
export function EditorToolbar({
  editor,
  access,
  page,
  onPage,
  textSize,
  onTextSize,
}: Props) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      formats: Object.fromEntries(
        formats.map((f) => [
          f.id,
          e.isActive(f.id === 'heading' ? 'heading' : f.id),
        ]),
      ),
      marks: Object.fromEntries(
        debateMarks.map((m) => [m, e.isActive('debateMark', { kind: m })]),
      ),
      layout: pageLayoutOf(e.state.doc),
    }),
  });
  const [focus, setFocus] = useState(0);
  const tools = useRef<(HTMLButtonElement | null)[]>([]);
  const roving = (index: number) => ({
    ref: (node: HTMLButtonElement | null) => {
      tools.current[index] = node;
    },
    tabIndex: index === focus ? 0 : -1,
    onFocus: () => setFocus(index),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = toolbarFocus(event.key, focus, toolCount);
    if (next === null) return;
    event.preventDefault();
    setFocus(next);
    tools.current[next]?.focus();
  };
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-raised px-2 py-1 max-narrow:flex-nowrap max-narrow:overflow-x-auto">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex shrink-0 flex-wrap items-center gap-1 max-narrow:flex-nowrap"
        onKeyDown={onKeyDown}
      >
        {formats.map((f, index) => (
          <button
            key={f.id}
            type="button"
            aria-label={f.label}
            aria-pressed={Boolean(active.formats[f.id])}
            className={tool(Boolean(active.formats[f.id]))}
            onClick={() => f.run(editor)}
            {...roving(index)}
          >
            <Icon name={f.icon} size={16} />
          </button>
        ))}
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
        <div
          role="group"
          aria-label="Debate marks"
          className="flex items-center gap-1"
        >
          {debateMarks.map((m, index) => (
            <button
              key={m}
              type="button"
              aria-pressed={Boolean(active.marks[m])}
              className={cn(
                'h-room-target shrink-0 cursor-pointer rounded-sm px-3 text-sm font-strong',
                markTone[m],
                active.marks[m] && 'ring-2 ring-current',
              )}
              onClick={() => editor.chain().focus().toggleDebateMark(m).run()}
              {...roving(formats.length + index)}
            >
              {markNames[m]}
            </button>
          ))}
        </div>
      </div>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-ink-faint">
        <Icon name="lock" size={13} />
        {access}
      </span>
      <select
        aria-label="Page"
        value={layoutValue(active.layout)}
        className="h-room-target shrink-0 cursor-pointer rounded-sm border border-border-strong bg-surface-raised px-2 text-sm text-ink"
        onChange={(event) =>
          editor
            .chain()
            .focus()
            .setPageLayout(layoutFrom(event.target.value))
            .run()
        }
      >
        <option value="portrait">Portrait</option>
        {pageColumnChoices.map((columns) => (
          <option key={columns} value={String(columns)}>
            Landscape · {columns} columns
          </option>
        ))}
      </select>
      <div role="group" aria-label="Text size" className="flex shrink-0 gap-px">
        <button
          type="button"
          aria-label="Smaller text"
          disabled={textSize === textSizes[0]}
          className={cn(tool(false), 'text-xs disabled:opacity-50')}
          onClick={() => onTextSize(stepTextSize(textSize, -1))}
        >
          A−
        </button>
        <button
          type="button"
          aria-label="Larger text"
          disabled={textSize === textSizes.at(-1)}
          className={cn(tool(false), 'text-md disabled:opacity-50')}
          onClick={() => onTextSize(stepTextSize(textSize, 1))}
        >
          A+
        </button>
      </div>
      <div
        role="group"
        aria-label="Page tone"
        className="flex shrink-0 gap-px rounded-sm border border-border p-px"
      >
        {(['dark', 'light'] as const).map((tone) => (
          <button
            key={tone}
            type="button"
            aria-label={tone === 'dark' ? 'Dark page' : 'Light page'}
            aria-pressed={page === tone}
            className={tool(page === tone)}
            onClick={() => onPage(tone)}
          >
            <Icon name={toneIcon[tone]} size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}
