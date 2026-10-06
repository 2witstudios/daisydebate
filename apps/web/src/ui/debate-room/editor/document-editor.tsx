'use client';

import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { documentExtensions } from '../../../features/debate-room/document-schema';
import type { WorkspaceDocument } from '../../../features/debate-room/documents';
import type { PageTone } from '../room-state';
import { EditorToolbar } from './editor-toolbar';

type Props = {
  readonly document: WorkspaceDocument;
  readonly access: string;
  readonly page: PageTone;
  readonly onPage: (tone: PageTone) => void;
  readonly onChange: (html: string) => void;
};

/**
 * The round document: Tiptap on the room's page surface. One editor per
 * document id; base CSS comes from the stylesheet (injectCSS off, the CSP
 * refuses its un-nonced style tag).
 */
export function DocumentEditor({
  document,
  access,
  page,
  onPage,
  onChange,
}: Props) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      injectCSS: false,
      extensions: [
        ...documentExtensions,
        Placeholder.configure({ placeholder: 'Write' }),
      ],
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editor ? (
        <EditorToolbar
          editor={editor}
          access={access}
          page={page}
          onPage={onPage}
        />
      ) : null}
      <div
        data-room-page={page}
        className="min-h-0 flex-1 overflow-y-auto bg-surface-raised"
      >
        <div className="mx-auto room-doc-column px-8 pt-6 pb-10">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
