'use client';

import { useState, type Dispatch } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { systemClock } from '@daisy/clock';
import { documentExtensions } from '../../features/documents/document-schema';
import type { WorkspaceDocument } from '../../features/debate-room/documents/documents';
import type { DocumentSync, RecoveredDraft } from './document-sync';
import type { RoomAction } from './room-state';

/** The same constrained schema as the editor; stored HTML is never injected into the page. */
function RecoveryPreview({
  html,
  label,
}: {
  readonly html: string;
  readonly label: string;
}) {
  const editor = useEditor(
    {
      immediatelyRender: false,
      injectCSS: false,
      editable: false,
      extensions: documentExtensions,
      content: html,
      editorProps: { attributes: { 'aria-label': label, class: 'room-doc' } },
    },
    [html],
  );
  return <EditorContent editor={editor} />;
}

function RecoveredNote({
  document,
  draft,
  restore,
  discard,
}: {
  readonly document: WorkspaceDocument;
  readonly draft: RecoveredDraft;
  readonly restore: () => void;
  readonly discard: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    try {
      const container = window.document.createElement('template');
      container.innerHTML = draft.html;
      await navigator.clipboard.writeText(container.content.textContent ?? '');
      setCopied('Copied recovered text.');
    } catch {
      setCopied('Copy was unavailable. Select the recovered text to copy it.');
    }
  };
  return (
    <section
      aria-label={`Recovered ${document.title}`}
      className="flex flex-col gap-2 border-b border-border p-3"
    >
      <h3 className="font-semibold">Recovered draft: {document.title}</h3>
      <p className="text-sm text-ink-muted">
        Your unsaved copy is separate from the server copy. Restore replaces the
        editor text; the server checks for newer changes when saving.
      </p>
      <details>
        <summary>Compare recovered and server copies</summary>
        <h4>Recovered copy</h4>
        <RecoveryPreview
          html={draft.html}
          label={`Recovered copy of ${document.title}`}
        />
        <h4>Server copy</h4>
        <RecoveryPreview
          html={document.html}
          label={`Server copy of ${document.title}`}
        />
      </details>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={restore}
          className="cursor-pointer px-3 py-1 text-sm text-ink"
        >
          Restore {document.title}
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="cursor-pointer px-3 py-1 text-sm text-ink"
        >
          Copy recovered {document.title}
        </button>
        <button
          type="button"
          onClick={discard}
          className="cursor-pointer px-3 py-1 text-sm text-ink-muted"
        >
          Discard recovered {document.title}
        </button>
      </div>
      {copied ? <p role="status">{copied}</p> : null}
    </section>
  );
}

/** Both Round surfaces offer the same explicit, document-labelled recovery choices. */
export function RecoveredNotes({
  documents,
  recovered,
  sync,
  dispatch,
}: {
  readonly documents: readonly WorkspaceDocument[];
  readonly recovered: ReadonlyMap<string, RecoveredDraft>;
  readonly sync: DocumentSync;
  readonly dispatch: Dispatch<RoomAction>;
}) {
  return (
    <>
      {documents
        .filter((doc) => recovered.has(doc.id))
        .map((document) => {
          const draft = recovered.get(document.id)!;
          return (
            <RecoveredNote
              key={document.id}
              document={document}
              draft={draft}
              restore={() => {
                sync.restoreRecovered(document.id);
                dispatch({
                  type: 'doc/recovered/restore',
                  id: document.id,
                  html: draft.html,
                  now: systemClock.now(),
                });
              }}
              discard={() => {
                if (sync.discardRecovered(document.id))
                  dispatch({ type: 'doc/recovered/discard', id: document.id });
              }}
            />
          );
        })}
    </>
  );
}
