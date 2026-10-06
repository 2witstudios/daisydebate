import type { Clock, IdGenerator } from '@daisy/clock';
import type { Database, DebateDocumentRecord } from '@daisy/db';
import { aiDebateTurns, type AiDebateTurn } from '@daisy/debate-engine';
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
  | 'getAiDebate'
  | 'createDebateDocument'
  | 'listDebateDocuments'
  | 'saveDebateDocument'
  | 'renameDebateDocument'
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

const toStored = (record: DebateDocumentRecord): StoredDocument => ({
  id: record.id,
  title: record.title,
  folder: record.folder,
  templateId: templateOf(record.templateId),
  html: record.html,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  revision: record.revision,
});

const toSlot = (turn: AiDebateTurn, index: number): SpeechSlot => ({
  id: `t${index}`,
  code: turn.name,
  side: turn.side === 'affirmative' ? 'aff' : 'neg',
  kind: turn.kind === 'cross-examination' ? 'cross-ex' : 'speech',
  durationMs: turn.durationMs,
});

const normalized = (html: string) => {
  const result = normalizeDocumentHtml(html);
  if (result.ok) return result.html;
  throw createAppError(
    result.reason === 'too-large' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION',
  );
};

/**
 * The round room's document operations (ADR 0054). Every call names its
 * principal and reaches only that user's documents; an AI debate is opened
 * only by its own person. HTML is normalized before it is stored, and time
 * and ids come from the injected clock and generator.
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
  const ownDebate = async (principal: DocumentPrincipal, id: string) => {
    const record = await store.getAiDebate(id);
    if (!record || record.actorId !== principal.actorId)
      throw createAppError('NOT_FOUND');
    return record;
  };
  const list = (principal: DocumentPrincipal, aiDebateId: string) =>
    store.listDebateDocuments({ ownerUserId: principal.userId, aiDebateId });

  return {
    async listDocuments(
      principal: DocumentPrincipal,
      { aiDebateId }: { readonly aiDebateId: string },
    ): Promise<StoredDocument[]> {
      await ownDebate(principal, aiDebateId);
      return (await list(principal, aiDebateId)).map(toStored);
    },

    async createDocument(
      principal: DocumentPrincipal,
      input: {
        readonly aiDebateId: string;
        readonly folder: 'round' | 'library';
        readonly templateId: TemplateId;
      },
    ): Promise<StoredDocument> {
      const debate = await ownDebate(principal, input.aiDebateId);
      const existingTitles = (await list(principal, input.aiDebateId))
        .filter((document) => document.folder === input.folder)
        .map((document) => document.title);
      const now = clock.now();
      const built = buildDocument({
        id: ids.next(),
        now,
        folder: input.folder,
        templateId: input.templateId,
        existingTitles,
        context: {
          side: debate.personSide === 'affirmative' ? 'aff' : 'neg',
          speeches: aiDebateTurns.map(toSlot),
          title: '',
        },
      });
      const record = await store.createDebateDocument({
        id: built.id,
        ownerUserId: principal.userId,
        aiDebateId: input.folder === 'round' ? input.aiDebateId : null,
        folder: input.folder,
        templateId: built.templateId,
        title: built.title.slice(0, TITLE_MAX),
        html: normalized(built.html),
        createdAt: new Date(now),
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
      const saved = await store.saveDebateDocument({
        id: input.id,
        ownerUserId: principal.userId,
        html: normalized(input.html),
        expectedRevision: input.expectedRevision,
        updatedAt: new Date(clock.now()),
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
      const renamed = await store.renameDebateDocument({
        id: input.id,
        ownerUserId: principal.userId,
        title,
        updatedAt: new Date(clock.now()),
      });
      if (!renamed) throw createAppError('NOT_FOUND');
      return toStored(renamed);
    },
  };
}

export type DebateDocumentOperations = ReturnType<
  typeof createDebateDocumentOperations
>;
