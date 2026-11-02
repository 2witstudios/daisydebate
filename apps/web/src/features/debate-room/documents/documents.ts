export type Side = 'aff' | 'neg';

export type SpeechSlot = {
  readonly id: string;
  readonly code: string;
  /** The full name, "Negative constructive"; the code is its short form. */
  readonly name: string;
  readonly side: Side;
  readonly kind: 'speech' | 'cross-ex';
  readonly durationMs: number;
};

/** A new document's title until its owner renames it. */
export const NEW_DOCUMENT_TITLE = 'Untitled';

/** A drive: the viewer's own, or their club's. */
export type FolderId = 'library' | 'club';

export type WorkspaceDocument = {
  readonly id: string;
  readonly title: string;
  readonly folder: FolderId;
  /** The document as HTML, the stored source of truth (ADR 0054). */
  readonly html: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The current text was adopted from the server, so Undo must not leave it. */
  readonly textFromServer?: true;
};

/** "Untitled", then "Untitled 2", "Untitled 3"… for the first title not already taken. */
export function uniqueTitle(base: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** A plain document: a title and an empty page, with nothing pre-filled. */
export function createDocument(input: {
  readonly id: string;
  readonly now: string;
  readonly folder: FolderId;
  readonly title?: string;
  readonly existingTitles: readonly string[];
}): WorkspaceDocument {
  return {
    id: input.id,
    title: uniqueTitle(
      input.title?.trim() || NEW_DOCUMENT_TITLE,
      input.existingTitles,
    ),
    folder: input.folder,
    html: '<p></p>',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function updateDocumentHtml(
  document: WorkspaceDocument,
  html: string,
  now: string,
): WorkspaceDocument {
  if (html === document.html) return document;
  const { textFromServer, ...rest } = document;
  return { ...(textFromServer ? rest : document), html, updatedAt: now };
}

/** Text a late commit put on the server, which the person did not type here. */
export function adoptServerText(
  document: WorkspaceDocument,
  html: string,
  now: string,
): WorkspaceDocument {
  if (html === document.html) return document;
  return { ...document, html, updatedAt: now, textFromServer: true };
}

export function renameDocument(
  document: WorkspaceDocument,
  title: string,
  now: string,
): WorkspaceDocument {
  const trimmed = title.trim();
  if (trimmed === '' || trimmed === document.title) return document;
  return { ...document, title: trimmed, updatedAt: now };
}
