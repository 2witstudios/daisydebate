import type { DocumentRecord } from '@daisy/db';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { createAppError, isAppError, type AppError } from '@daisy/errors';
import {
  createDocument as buildDocument,
  documentTemplates,
  type SpeechSlot,
  type TemplateId,
  type WorkspaceDocument,
} from './documents';
import { normalizeDocumentHtml } from './normalize-html';

export type DebateDocumentStore = Pick<
  Database,
  | 'getRound'
  | 'createDocument'
  | 'listDocuments'
  | 'saveDocument'
  | 'renameDocument'
  | 'attachRoundDocument'
>;

/** The signed-in user and their competitive actor, resolved at the edge. */
export type DocumentPrincipal = {
  readonly userId: string;
  readonly actorId: string;
};

/** A stored document as the room shows it, with its save revision. */
export type StoredDocument = WorkspaceDocument & { readonly revision: number };

const TITLE_MAX = 120;

/** A save against a stale revision; `revision` is the current one. */
type DocumentConflict = AppError & { readonly revision: number };

const conflict = (revision: number): DocumentConflict =>
  Object.assign(createAppError('CONFLICT', 'The document moved on'), {
    revision,
  });

/** The current revision a refused save reported, or null for other errors. */
export const conflictRevision = (error: unknown): number | null =>
  isAppError(error) &&
  error.code === 'CONFLICT' &&
  typeof (error as Partial<DocumentConflict>).revision === 'number'
    ? (error as DocumentConflict).revision
    : null;

const templateOf = (id: string): TemplateId =>
  documentTemplates.find((template) => template.id === id)?.id ?? 'blank';

const toStored = (record: DocumentRecord): StoredDocument => ({
  id: record.id,
  title: record.title,
  // The workspace names the two folders it shows; scratch documents
  // surfaced here belong to the round's work.
  folder: record.folder === 'library' ? 'library' : 'round',
  templateId: templateOf(record.templateId),
  html: record.html,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  revision: record.revision,
});

const toSlot = (
  segment: {
    readonly key: string;
    readonly type: string;
    readonly side: string;
    readonly durationMs: number;
  },
  index: number,
): SpeechSlot => ({
  id: `t${index}`,
  code: segment.key,
  side: segment.side === 'affirmative' ? 'aff' : 'neg',
  kind: segment.type === 'cross_ex' ? 'cross-ex' : 'speech',
  durationMs: segment.durationMs,
});

const normalized = (html: string) => {
  const result = normalizeDocumentHtml(html);
  if (result.ok) return result.html;
  throw createAppError(
    result.reason === 'too-large' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION',
  );
};

/**
 * The round room's document operations (ADR 0054, ADR 0058 §9). Documents
 * are the member's — owned by their actor, with no round FK; the round's
 * workspace is a view over them carried by round_document_refs. Every call
 * names its principal and reaches only their documents; a round is opened
 * only by its own participant. HTML is normalized before it is stored, and
 * time and ids come from the injected clock and generator.
 */
export function createDebateDocumentOperations({
  store,
  clock,
  ids,
}: {
  readonly store: DebateDocumentStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}) {
  const ownRound = async (principal: DocumentPrincipal, id: string) => {
    const round = await store.getRound(id);
    if (
      !round ||
      !round.participants.some((seat) => seat.actorId === principal.actorId)
    )
      throw createAppError('NOT_FOUND');
    return round;
  };

  return {
    async listDocuments(
      principal: DocumentPrincipal,
      { roundId }: { readonly roundId: string },
    ): Promise<StoredDocument[]> {
      await ownRound(principal, roundId);
      const records = await store.listDocuments({
        ownerActorId: principal.actorId,
        roundId,
      });
      return records.map(toStored);
    },

    async createDocument(
      principal: DocumentPrincipal,
      input: {
        readonly roundId: string;
        readonly folder: 'round' | 'library';
        readonly templateId: TemplateId;
      },
    ): Promise<StoredDocument> {
      const round = await ownRound(principal, input.roundId);
      const existingTitles = (
        await store.listDocuments({
          ownerActorId: principal.actorId,
          roundId: input.roundId,
        })
      )
        .filter((document) =>
          input.folder === 'library'
            ? document.folder === 'library'
            : document.folder !== 'library',
        )
        .map((document) => document.title);
      const personSide =
        round.participants.find((seat) => seat.actorId === principal.actorId)
          ?.role ?? 'affirmative';
      const now = clock.now();
      const built = buildDocument({
        id: ids.next(),
        now,
        folder: input.folder,
        templateId: input.templateId,
        existingTitles,
        context: {
          side: personSide === 'affirmative' ? 'aff' : 'neg',
          speeches: round.rules.segments.map(toSlot),
          title: '',
        },
      });
      const record = await store.createDocument({
        id: built.id,
        ownerActorId: principal.actorId,
        title: built.title.slice(0, TITLE_MAX),
        html: normalized(built.html),
        templateId: built.templateId,
        folder: input.folder === 'library' ? 'library' : 'scratch',
      });
      if (input.folder === 'round')
        await store.attachRoundDocument({
          roundId: input.roundId,
          documentId: record.id,
          role: 'notes',
        });
      return toStored(record);
    },

    async saveDocument(
      principal: DocumentPrincipal,
      input: {
        readonly id: string;
        readonly html: string;
        readonly expectedRevision: number;
      },
    ): Promise<{ readonly revision: number }> {
      const saved = await store.saveDocument({
        id: input.id,
        ownerActorId: principal.actorId,
        html: normalized(input.html),
        expectedRevision: input.expectedRevision,
      });
      if (saved.status === 'missing') throw createAppError('NOT_FOUND');
      if (saved.status === 'conflict') throw conflict(saved.revision);
      return { revision: saved.revision };
    },

    async renameDocument(
      principal: DocumentPrincipal,
      input: { readonly id: string; readonly title: string },
    ): Promise<StoredDocument> {
      const title = input.title.trim();
      if (title.length < 1 || title.length > TITLE_MAX)
        throw createAppError('VALIDATION', 'Title length');
      const renamed = await store.renameDocument({
        id: input.id,
        ownerActorId: principal.actorId,
        title,
      });
      if (!renamed) throw createAppError('NOT_FOUND');
      return toStored(renamed);
    },
  };
}

export type DebateDocumentOperations = ReturnType<
  typeof createDebateDocumentOperations
>;
