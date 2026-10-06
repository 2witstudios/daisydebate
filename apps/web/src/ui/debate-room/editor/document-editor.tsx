'use client';

import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type {
  DocJSON,
  WorkspaceDocument,
} from '../../../features/debate-room/documents';
import type { PageTone } from '../room-state';
import { DebateMarkExtension } from './debate-mark';
import { EditorToolbar } from './editor-toolbar';

type Props = {
  readonly document: WorkspaceDocument;
  readonly access: string;
  readonly page: PageTone;
  readonly onPage: (tone: PageTone) => void;
  readonly onChange: (content: DocJSON) => void;
};

// The editor's own output: ProseMirror only emits nodes its schema knows.
const fromEditor = (json: JSONContent): DocJSON => json as DocJSON;

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
        StarterKit.configure({ link: false, code: false, codeBlock: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: 'Write' }),
        DebateMarkExtension,
      ],
      content: document.content as JSONContent,
      editorProps: {
        attributes: {
          class: 'room-doc min-h-full',
          'aria-label': document.title,
        },
      },
      onUpdate: ({ editor: current }) =>
        onChange(fromEditor(current.getJSON())),
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
