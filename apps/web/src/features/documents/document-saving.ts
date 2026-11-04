import { sameDocumentHtml } from './document-lines';
import {
  acknowledgeDraftRecord,
  draftCopies,
  ownUnansweredCommit,
  sameDraftCopy,
  settleDraftRecord,
  type DraftCopy,
  type DraftRecord,
  type DraftTransition,
} from './document-draft';

/** What the browser's draft storage held at the last read, with its raw value for compare-and-swap. */
export type DraftSnapshot = {
  readonly record: DraftRecord;
  readonly raw: string | null;
};

/** The server's text and revision for a document this owner has read. */
export type ServerDocument = {
  readonly id: string;
  readonly html: string;
  readonly revision: number;
};

/** A retained copy, with the last server text this owner has proven to compare it against. */
export type DraftOffer = {
  readonly documentId: string;
  readonly slot: 'active' | 'recovery';
  readonly copy: DraftCopy;
  readonly serverHtml: string;
};

/** Everything one owner knows about saving one document. */
export type SavingDocument = {
  /** Undefined until the server's revision is read; nothing saves before that. */
  readonly revision: number | undefined;
  readonly serverHtml: string | undefined;
  readonly pending: DraftCopy | undefined;
  readonly snapshot: DraftSnapshot | undefined;
  /** The generation this owner has safely in draft storage. */
  readonly durableGeneration: string | undefined;
  /** Generations this owner wrote that its next acknowledgement replaces. */
  readonly ownEarlier: readonly string[];
  readonly failures: number;
  /** The generation the server refused; a newer edit may still send. */
  readonly refusedGeneration: string | undefined;
  /** A refused compare-and-swap, holding the server's newest revision once read. */
  readonly conflict: { readonly latestRevision: number } | undefined;
  /** The server no longer has this document; the typed text is kept. */
  readonly gone: boolean;
  /**
   * Recent uncertain requests since the last acknowledgement, bounded because
   * they hold private text; past the bound a false conflict is the safe failure.
   */
  readonly unanswered: readonly DraftCopy[];
  readonly storageProblem: boolean;
};

export type ClosedBy = 'released' | 'fence' | 'purge';

/** One owner's whole saving state. */
export type SavingState = {
  readonly documents: ReadonlyMap<string, SavingDocument>;
  readonly offers: readonly DraftOffer[];
  readonly closedBy: ClosedBy | null;
};

export const initialSaving: SavingState = {
  documents: new Map(),
  offers: [],
  closedBy: null,
};

const unread: SavingDocument = {
  revision: undefined,
  serverHtml: undefined,
  pending: undefined,
  snapshot: undefined,
  durableGeneration: undefined,
  ownEarlier: [],
  failures: 0,
  refusedGeneration: undefined,
  conflict: undefined,
  gone: false,
  unanswered: [],
  storageProblem: false,
};

export const savingDocument = (
  state: SavingState,
  id: string,
): SavingDocument => state.documents.get(id) ?? unread;

export const withDocument = (
  state: SavingState,
  id: string,
  change: (document: SavingDocument) => SavingDocument,
): SavingState => ({
  ...state,
  documents: new Map(state.documents).set(
    id,
    change(savingDocument(state, id)),
  ),
});

/** The server's copy, as read. */
export const serverRead = (
  document: SavingDocument,
  { html, revision }: Omit<ServerDocument, 'id'>,
): SavingDocument => ({ ...document, revision, serverHtml: html });

const owned = (document: SavingDocument, generation: string) =>
  document.pending?.generation === generation ||
  document.durableGeneration === generation;

/** A stored active copy this owner did not write is another's text to offer. */
export const activeOffered = (
  document: SavingDocument,
  record: DraftRecord,
): boolean =>
  record.active !== undefined && !owned(document, record.active.generation);

/** A copy matching the server's text is finished. */
export const settledBy = (record: DraftRecord, html: string): DraftRecord =>
  settleDraftRecord(record, (copy) => sameDocumentHtml(copy, html));

/** Every copy worth offering, never one based on a revision this owner has not seen. */
export const offersOf = (
  documents: ReadonlyMap<string, SavingDocument>,
): readonly DraftOffer[] =>
  [...documents].flatMap(([documentId, document]) => {
    const record = document.snapshot?.record;
    if (!record || draftCopies(record).length === 0) return [];
    const serverHtml = document.serverHtml ?? '';
    const candidates: DraftOffer[] = [];
    if (record.recovery)
      candidates.push({
        documentId,
        slot: 'recovery',
        copy: record.recovery,
        serverHtml,
      });
    if (record.active && activeOffered(document, record))
      candidates.push({
        documentId,
        slot: 'active',
        copy: record.active,
        serverHtml,
      });
    return candidates.filter(
      (offer) => offer.copy.baseRevision <= (document.revision ?? -1),
    );
  });

export const sameOffers = (
  one: readonly DraftOffer[],
  two: readonly DraftOffer[],
): boolean =>
  one.length === two.length &&
  one.every((offer, i) => {
    const other = two[i];
    return (
      other !== undefined &&
      offer.documentId === other.documentId &&
      offer.slot === other.slot &&
      offer.serverHtml === other.serverHtml &&
      sameDraftCopy(offer.copy, other.copy)
    );
  });

/** The earliest moment a retained copy expires, or null with none retained. */
export const nextExpiry = (
  documents: ReadonlyMap<string, SavingDocument>,
): number | null => {
  const deadlines = [...documents.values()].flatMap((document) =>
    document.snapshot
      ? draftCopies(document.snapshot.record).map((copy) => copy.expiresAt)
      : [],
  );
  return deadlines.length > 0 ? Math.min(...deadlines) : null;
};

/** What an owner with nothing moving should say about a document. */
export type IdleSignal =
  | { readonly kind: 'conflict'; readonly id: string }
  | { readonly kind: 'recovery' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'busy' };

export const idleSignal = (state: SavingState): IdleSignal => {
  const documents = [...state.documents];
  const conflicted = documents.find(([, document]) => document.conflict);
  if (conflicted) return { kind: 'conflict', id: conflicted[0] };
  if (
    documents.some(
      ([, document]) => document.pending || document.storageProblem,
    )
  )
    return { kind: 'busy' };
  return state.offers.length > 0 ? { kind: 'recovery' } : { kind: 'saved' };
};

/** A new edit: it replaces what is pending and is this owner's own from now on. */
export const edited = (
  document: SavingDocument,
  copy: DraftCopy,
): SavingDocument => ({
  ...document,
  pending: copy,
  ownEarlier: [...document.ownEarlier, copy.generation],
});

/** Text the server already holds is no edit, unless it undoes one still pending. */
export const isNoEdit = (document: SavingDocument, html: string): boolean =>
  !document.pending && sameDocumentHtml(html, document.serverHtml ?? '');

/** The save this document is ready to send, or null when it must wait. */
export const nextSend = (
  document: SavingDocument,
): {
  readonly sent: DraftCopy;
  readonly expectedRevision: number;
} | null => {
  const { pending, revision, refusedGeneration, conflict, gone } = document;
  if (
    gone ||
    !pending ||
    revision === undefined ||
    refusedGeneration === pending.generation ||
    conflict
  )
    return null;
  return { sent: pending, expectedRevision: revision };
};

/**
 * The server committed `sent`. Returns the document and the draft change: the
 * acknowledged generation goes, a named newer edit rebases, and with nothing
 * newer pending this owner's earlier copies go too.
 */
export const acknowledged = (
  document: SavingDocument,
  sent: DraftCopy,
  revision: number,
  record: DraftRecord,
): { readonly document: SavingDocument; readonly draft: DraftTransition } => {
  const current = document.pending;
  const pending =
    current?.generation === sent.generation
      ? undefined
      : current && { ...current, baseRevision: revision };
  const draft = acknowledgeDraftRecord(record, {
    generation: sent.generation,
    revision,
    rebaseGeneration: pending?.generation ?? null,
    supersededByThisOwner: (generation) =>
      document.ownEarlier.includes(generation),
  });
  return {
    document: {
      ...document,
      revision,
      serverHtml: sent.html,
      failures: 0,
      unanswered: [],
      pending,
      // The server holds this text now, so its durability is no longer at risk.
      storageProblem: pending ? document.storageProblem : false,
      ownEarlier: pending ? document.ownEarlier : [],
    },
    draft,
  };
};

/** How a refused compare-and-swap resolves once the server's copy is read. */
export type ConflictOutcome =
  | {
      readonly kind: 'committed';
      readonly copy: DraftCopy;
      readonly revision: number;
    }
  | { readonly kind: 'conflicted'; readonly latestRevision: number }
  | { readonly kind: 'gone' };

export const conflictOutcome = (
  document: SavingDocument,
  sent: DraftCopy,
  reportedRevision: number,
  server: ServerDocument | undefined,
): ConflictOutcome => {
  if (!server) return { kind: 'gone' };
  // The server already holds exactly this text, so nothing conflicts: an exit
  // save landed after the page's look, however late.
  if (sameDocumentHtml(server.html, sent.html))
    return { kind: 'committed', copy: sent, revision: server.revision };
  const own =
    server.revision === reportedRevision
      ? ownUnansweredCommit(document.unanswered, reportedRevision, (html) =>
          sameDocumentHtml(server.html, html),
        )
      : undefined;
  if (own) return { kind: 'committed', copy: own, revision: reportedRevision };
  return { kind: 'conflicted', latestRevision: server.revision };
};

const UNANSWERED_LIMIT = 8;
const LONGEST_BACKOFF_MS = 30_000;

const retryable = (status: number | null) =>
  status === null || status === 408 || status === 429 || status >= 500;

/** A failed request's effect: refused for good, or kept and retried with backoff. */
export type AttemptFailure =
  | { readonly kind: 'gone'; readonly document: SavingDocument }
  | {
      readonly kind: 'refused';
      readonly document: SavingDocument;
      readonly status: number;
    }
  | {
      readonly kind: 'retry';
      readonly document: SavingDocument;
      readonly attempts: number;
      readonly afterMs: number;
    };

export const attemptFailed = (
  document: SavingDocument,
  sent: DraftCopy,
  status: number | null,
  delayMs: number,
): AttemptFailure => {
  // Deleted elsewhere: no retry can land, and the text stays for the person.
  if (status === 404)
    return { kind: 'gone', document: { ...document, gone: true } };
  if (status !== null && !retryable(status))
    return {
      kind: 'refused',
      status,
      document: { ...document, refusedGeneration: sent.generation },
    };
  const earlier = document.unanswered;
  // Keep the oldest: it is the one most likely to have committed unanswered.
  const [oldest, ...rest] = earlier;
  const unanswered = earlier.some((copy) => copy.generation === sent.generation)
    ? earlier
    : oldest
      ? [oldest, ...rest.slice(-(UNANSWERED_LIMIT - 2)), sent]
      : [sent];
  const attempts = document.failures + 1;
  return {
    kind: 'retry',
    attempts,
    afterMs: Math.min(delayMs * 2 ** attempts, LONGEST_BACKOFF_MS),
    document: { ...document, unanswered, failures: attempts },
  };
};

/** Restore resolves a conflict and saves against the fresh server revision. */
export const restored = (
  document: SavingDocument,
  copy: DraftCopy,
  setAside: string | undefined,
  revision: number,
): SavingDocument => ({
  ...document,
  pending: copy,
  durableGeneration: copy.generation,
  // Text Restore set aside is a choice to keep, not a superseded draft.
  ownEarlier: [
    ...document.ownEarlier.filter((generation) => generation !== setAside),
    copy.generation,
  ],
  revision,
  conflict: undefined,
});

/** Whether closing now would destroy text with no stored copy. */
export const holdsUnstoredText = (state: SavingState): boolean =>
  [...state.documents.values()].some(
    (document) =>
      document.pending &&
      document.durableGeneration !== document.pending.generation,
  );

/** Closing ends every kind of work and keeps only what the server has told us. */
export const closed = (state: SavingState, reason: ClosedBy): SavingState => ({
  closedBy: reason,
  offers: [],
  documents: new Map(
    [...state.documents].map(([id, document]) => [
      id,
      {
        ...document,
        pending: undefined,
        snapshot: undefined,
        unanswered: [],
        durableGeneration: undefined,
        ownEarlier: [],
      },
    ]),
  ),
});
