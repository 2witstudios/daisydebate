'use client';

import { useState, useSyncExternalStore, type Dispatch } from 'react';
import { generateJSON, generateText } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { systemClock } from '@daisy/clock';
import { documentExtensions } from '../../features/documents/document-schema';
import type { MemberDocument } from '../../features/documents/document';
import type { DocumentSync, DraftOffer } from './document-sync';
import type { DraftCopy } from '../../features/documents/document-draft';
import type { ManagerAction } from '../../features/documents/document-manager-state';

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

function RecoveredDraft({
  document,
  draft,
  serverHtml,
  choiceLabel,
  restore,
  discard,
}: {
  readonly document: MemberDocument;
  readonly draft: DraftCopy;
  readonly serverHtml: string;
  readonly choiceLabel: string;
  readonly restore: () => void;
  readonly discard: () => void;
}) {
  const [manualText, setManualText] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    let text = draft.html;
    try {
      // Block-aware, so paragraphs and list items do not run together.
      text = generateText(
        generateJSON(draft.html, documentExtensions),
        documentExtensions,
        { blockSeparator: '\n\n' },
      ).trimEnd();
      await navigator.clipboard.writeText(text);
      setManualText(null);
      setCopied('Copied recovered text.');
    } catch {
      setManualText(text);
      setCopied(
        'Copy was unavailable. Select the recovered text below to copy it.',
      );
    }
  };
  return (
    <section
      aria-label={`Recovered ${choiceLabel}`}
      className="flex flex-col gap-2 border-b border-border p-3"
    >
      <h3 className="font-semibold">Recovered draft: {choiceLabel}</h3>
      <p className="text-sm text-ink-muted">
        Restore replaces the editor text.
      </p>
      <details>
        <summary>Compare recovered and server copies</summary>
        <h4>Recovered copy</h4>
        <RecoveryPreview
          html={draft.html}
          label={`Recovered copy of ${choiceLabel}`}
        />
        <h4>Server copy</h4>
        <RecoveryPreview
          html={serverHtml}
          label={`Server copy of ${document.title}`}
        />
      </details>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={restore}
          className="cursor-pointer px-3 py-1 text-sm text-ink"
        >
          Restore {choiceLabel}
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="cursor-pointer px-3 py-1 text-sm text-ink"
        >
          Copy recovered {choiceLabel}
        </button>
        <button
          type="button"
          onClick={discard}
          className="cursor-pointer px-3 py-1 text-sm text-ink-muted"
        >
          Discard recovered {choiceLabel}
        </button>
      </div>
      {copied ? <p role="status">{copied}</p> : null}
      {manualText !== null ? (
        <label className="flex flex-col gap-1 text-sm">
          Recovered text to copy from {choiceLabel}
          <textarea
            readOnly
            rows={5}
            value={manualText}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-sm border border-border p-2"
          />
        </label>
      ) : null}
    </section>
  );
}

/** A document deleted elsewhere while open here: the text stays until the person chooses. */
function DeletedDocumentNotice({
  title,
  saveAsNew,
  failed,
}: {
  readonly title: string;
  readonly saveAsNew: () => void;
  readonly failed: boolean;
}) {
  return (
    <div role="alert" className="flex items-center gap-3 p-3 text-sm">
      <p className="min-w-0 flex-1">
        {title} was deleted. Your text is still here.
        {failed ? ' It was not saved as a new document. Try again.' : ''}
      </p>
      <button
        type="button"
        onClick={saveAsNew}
        className="h-room-target cursor-pointer rounded-sm bg-accent px-3 font-strong text-accent-ink"
      >
        Save as a new document
      </button>
    </div>
  );
}

const noOffers: readonly DraftOffer[] = [];

/** The sync owner projects the durable offers; UI state cannot retain a consumed copy. */
export function RecoveredDrafts({
  documents,
  sync,
  dispatch,
  inFolderPage = false,
}: {
  readonly documents: readonly MemberDocument[];
  readonly sync: DocumentSync;
  readonly dispatch: Dispatch<ManagerAction>;
  /** This tree's root is a folder, and a saved copy lands in My drive above it. */
  readonly inFolderPage?: boolean;
}) {
  const offers = useSyncExternalStore(
    sync.subscribe,
    sync.recoveryOffers,
    () => noOffers,
  );
  const gone = useSyncExternalStore(sync.subscribe, sync.firstGone, () => null);
  const [copyFailed, setCopyFailed] = useState(false);
  return (
    <>
      {gone ? (
        <DeletedDocumentNotice
          title={
            documents.find((one) => one.id === gone)?.title ?? 'This document'
          }
          saveAsNew={() => {
            sync.saveAsNew(gone).then(
              (created) => {
                if (!created) return;
                dispatch({ type: 'drive/remove', id: gone });
                dispatch({ type: 'doc/add', document: created });
                if (inFolderPage) return;
                dispatch({
                  type: 'drive/add',
                  folderId: null,
                  entry: {
                    kind: 'document',
                    id: created.id,
                    title: created.title,
                  },
                });
              },
              () => setCopyFailed(true),
            );
          }}
          failed={copyFailed}
        />
      ) : null}
      {offers.map((offer) => {
        const document = documents.find((item) => item.id === offer.documentId);
        if (!document) return null;
        return (
          <RecoveredDraft
            key={`${document.id}:${offer.copy.generation}`}
            document={document}
            draft={offer.copy}
            serverHtml={offer.serverHtml}
            choiceLabel={
              offers.filter((item) => item.documentId === document.id).length >
              1
                ? `${document.title} (${offer.slot === 'active' ? 'paused edit' : 'recovery copy'})`
                : document.title
            }
            restore={() => {
              const html = sync.restoreRecovered(
                document.id,
                offer.copy.generation,
              );
              if (html === null) return;
              dispatch({
                type: 'doc/update',
                id: document.id,
                html,
                now: systemClock.now(),
              });
              dispatch({ type: 'tabs/open', id: document.id });
            }}
            discard={() => {
              sync.discardRecovered(document.id, offer.copy.generation);
            }}
          />
        );
      })}
    </>
  );
}
