'use client';

import { useDeliver } from '../edge/use-answer';
import type { PageTone } from '../../features/documents/document-manager-state';
import { createDocument } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useMemo, useState } from 'react';
import { sameDocumentHtml } from '../../features/documents/document-lines';
import { documentExtensions } from '../../features/documents/document-schema';
import { EditorToolbar } from './editor-toolbar';
import { outsideTextTransaction } from './outside-text';
import { DEFAULT_TEXT_SIZE, type TextSize } from './editor-view';

const editorAttributes = (title: string) => ({
  class: 'room-doc flex-1 px-10 pt-6 pb-10 max-compact:px-4',
  'aria-label': title,
});

/** The page surface a document is edited on. */
export type { PageTone };

/** What the editor needs of a document: debate-room documents and prep briefs both satisfy it. */
type EditableDocument = {
  readonly id: string;
  readonly title: string;
  readonly html: string;
  readonly textFromServer?: true;
};

type Props = {
  readonly document: EditableDocument;
  readonly access: string;
  /** The viewer's own choice for this page; null follows their theme. */
  readonly page: PageTone | null;
  readonly onPage: (tone: PageTone | null) => void;
  readonly onChange: (html: string) => void;
};

/**
 * A rich document (any member document): Tiptap on a page surface. One editor per
 * document id, kept in step with the stored HTML; base CSS comes from the stylesheet (injectCSS off, the CSP
 * refuses its un-nonced style tag). The text size is the viewer's own and
 * never saved.
 */
export function DocumentEditor({
  document,
  access,
  page,
  onPage,
  onChange,
}: Props) {
  const [textSize, setTextSize] = useState<TextSize>(DEFAULT_TEXT_SIZE);
  const editor = useEditor(
    {
      immediatelyRender: false,
      injectCSS: false,
      extensions: documentExtensions,
      content: document.html,
      editorProps: {
        attributes: editorAttributes(document.title),
      },
      onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    },
    [document.id],
  );

  // Renaming changes the accessible name on the existing view, preserving its
  // content, history and selection rather than rebuilding the editor.
  const named = useMemo(
    () => ({ editor, title: document.title }),
    [editor, document.title],
  );
  useDeliver(named, ({ editor: open, title }) => {
    open?.setOptions({
      editorProps: {
        ...open.options.editorProps,
        attributes: editorAttributes(title),
      },
    });
  });

  // A change from outside the editor (an applied agent edit, a server load)
  // goes into the open editor without echoing back as a local update.
  const stored = useMemo(
    () => ({
      editor,
      html: document.html,
      undoable: document.textFromServer !== true,
    }),
    [editor, document.html, document.textFromServer],
  );
  useDeliver(stored, ({ editor: open, html, undoable }) => {
    if (!open || sameDocumentHtml(open.getHTML(), html)) return;
    const change = outsideTextTransaction(
      open.state,
      createDocument(html, open.schema),
      { undoable },
    );
    if (change) open.view.dispatch(change);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editor ? (
        <EditorToolbar
          editor={editor}
          access={access}
          page={page}
          onPage={onPage}
          textSize={textSize}
          onTextSize={setTextSize}
        />
      ) : null}
      <div
        data-room-page={page ?? undefined}
        data-doc-size={textSize}
        className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-raised"
      >
        <EditorContent editor={editor} className="flex flex-1 flex-col" />
      </div>
    </div>
  );
}
