'use client';

import { useEditorState, type Editor } from '@tiptap/react';
import {
  debateMarks,
  type DebateMark,
} from '../../../features/debate-room/documents';
import { cn } from '../../cn';
import { Icon, type IconName } from '../../components/icon/icon';
import type { PageTone } from '../room-state';

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
    'flex size-8 cursor-pointer items-center justify-center rounded-sm transition-colors',
    on ? 'bg-surface-overlay text-ink' : 'text-ink-muted hover:text-ink',
  );

type Props = {
  readonly editor: Editor;
  readonly access: string;
  readonly page: PageTone;
  readonly onPage: (tone: PageTone) => void;
};

/** Formatting, the five debate marks, who can read it, and the page tone. */
export function EditorToolbar({ editor, access, page, onPage }: Props) {
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
    }),
  });
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-raised px-2 py-1"
    >
      {formats.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-label={f.label}
          aria-pressed={Boolean(active.formats[f.id])}
          className={tool(Boolean(active.formats[f.id]))}
          onClick={() => f.run(editor)}
        >
          <Icon name={f.icon} size={16} />
        </button>
      ))}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      {debateMarks.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={Boolean(active.marks[m])}
          className={cn(
            'h-6 cursor-pointer rounded-round px-2 text-xs font-strong',
            markTone[m],
            active.marks[m] && 'ring-1 ring-current',
          )}
          onClick={() => editor.chain().focus().toggleDebateMark(m).run()}
        >
          {markNames[m]}
        </button>
      ))}
      <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint">
        <Icon name="lock" size={13} />
        {access}
      </span>
      <div
        role="group"
        aria-label="Page"
        className="ml-2 flex gap-px rounded-sm border border-border p-px"
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
