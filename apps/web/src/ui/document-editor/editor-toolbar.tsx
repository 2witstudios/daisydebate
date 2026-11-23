'use client';

import { Button } from '../components/button/button';
import { useEditorState, type Editor } from '@tiptap/react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../components/icon/icon';
import type { PageTone } from './document-editor';
import {
  stepTextSize,
  textSizes,
  toolbarFocus,
  type TextSize,
} from './editor-view';

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

type Props = {
  readonly editor: Editor;
  readonly access: string;
  /** The viewer's own choice for this page; null follows their theme. */
  readonly page: PageTone | null;
  readonly onPage: (tone: PageTone | null) => void;
  readonly textSize: TextSize;
  readonly onTextSize: (size: TextSize) => void;
};

/**
 * Formatting as one toolbar (one tab stop, arrow keys within it), then who can read the file, the view's
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
    const next = toolbarFocus(event.key, focus, formats.length);
    if (next === null) return;
    event.preventDefault();
    setFocus(next);
    tools.current[next]?.focus();
  };
  return (
    <div className="flex min-h-tab-strip shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface-raised px-2">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex shrink-0 items-center gap-px"
        onKeyDown={onKeyDown}
      >
        {formats.map((f, index) => (
          <Button
            variant="icon"
            key={f.id}
            aria-label={f.label}
            aria-pressed={Boolean(active.formats[f.id])}
            size="dense"
            onClick={() => f.run(editor)}
            {...roving(index)}
            type="button"
          >
            <Icon name={f.icon} size={16} />
          </Button>
        ))}
      </div>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-ink-faint">
        <Icon name="lock" size={13} />
        {access}
      </span>
      <div role="group" aria-label="Text size" className="flex shrink-0 gap-px">
        <Button
          variant="icon"
          type="button"
          aria-label="Smaller text"
          disabled={textSize === textSizes[0]}
          size="dense"
          className="text-xs"
          onClick={() => onTextSize(stepTextSize(textSize, -1))}
        >
          A−
        </Button>
        <Button
          variant="icon"
          type="button"
          aria-label="Larger text"
          disabled={textSize === textSizes.at(-1)}
          size="dense"
          className="text-md"
          onClick={() => onTextSize(stepTextSize(textSize, 1))}
        >
          A+
        </Button>
      </div>
      <div role="group" aria-label="Page tone" className="flex shrink-0 gap-px">
        {(['dark', 'light'] as const).map((tone) => (
          <Button
            variant="icon"
            key={tone}
            type="button"
            aria-label={tone === 'dark' ? 'Dark page' : 'Light page'}
            aria-pressed={page === tone}
            size="dense"
            onClick={() => onPage(page === tone ? null : tone)}
          >
            <Icon name={toneIcon[tone]} size={15} />
          </Button>
        ))}
      </div>
    </div>
  );
}
