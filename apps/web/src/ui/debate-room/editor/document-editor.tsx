'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { sameDocumentHtml } from '../../../features/debate-room/documents/document-lines';
import { documentExtensions } from '../../../features/debate-room/documents/document-schema';
import type { WorkspaceDocument } from '../../../features/debate-room/documents/documents';
import type { PageTone } from '../room-state';
import { EditorToolbar } from './editor-toolbar';
import { DEFAULT_TEXT_SIZE, type TextSize } from './editor-view';

type Props = {
  readonly document: WorkspaceDocument;
  readonly access: string;
  readonly page: PageTone;
  readonly onPage: (tone: PageTone) => void;
  readonly onChange: (html: string) => void;
};

/**
 * The round document: Tiptap on the room's page surface. One editor per
 * document id, kept in step with the stored HTML; base CSS comes from the stylesheet (injectCSS off, the CSP
 * refuses its un-nonced style tag). The text size is the viewer's own and
 * never saved; the page layout is part of the document.
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
    editor.commands.setContent(document.html, { emitUpdate: false });
  }, [editor, document.html]);

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
        data-room-page={page}
        data-doc-size={textSize}
        className="min-h-0 flex-1 overflow-auto bg-surface-raised"
      >
        <div className="mx-auto room-doc-column px-8 pt-6 pb-10">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
