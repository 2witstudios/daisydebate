'use client';

import type { PageTone } from '../../features/documents/document-manager-state';
import { createDocument } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { sameDocumentHtml } from '../../features/documents/document-lines';
import { documentExtensions } from '../../features/documents/document-schema';
import { EditorToolbar } from './editor-toolbar';
import { outsideTextTransaction } from './outside-text';
import { DEFAULT_TEXT_SIZE, type TextSize } from './editor-view';

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
        attributes: {
          class: 'room-doc min-h-full',
          'aria-label': document.title,
        },
      },
      onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    },
    [document.id],
  );

  // A change from outside the editor (an applied agent edit, a server load)
  // goes into the open editor without echoing back as a local update.
  useEffect(() => {
    if (!editor || sameDocumentHtml(editor.getHTML(), document.html)) return;
    const change = outsideTextTransaction(
      editor.state,
      createDocument(document.html, editor.schema),
      { undoable: document.textFromServer !== true },
    );
    if (change) editor.view.dispatch(change);
  }, [editor, document.html, document.textFromServer]);

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
        className="min-h-0 flex-1 overflow-auto bg-surface-raised"
      >
        <div className="px-10 pt-6 pb-10 max-compact:px-4">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
