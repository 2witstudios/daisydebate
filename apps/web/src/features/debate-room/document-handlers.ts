import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { z } from 'zod';
import type { createAiDebateHandlers } from '../ai-debate/handlers';
import { consumeOrThrow } from '../auth/rate-limit';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
  requireSignedIn,
} from '../../server/http';
import {
  conflictRevision,
  type DebateDocumentOperations,
  type DocumentPrincipal,
} from './document-operations';
import { documentTemplates, type TemplateId } from './documents';
import { DOCUMENT_MAX_BYTES } from './normalize-html';

/** The AI debate routes' gates (same origin, member, actor), with these operations. */
type Dependencies = Omit<
  Parameters<typeof createAiDebateHandlers>[0],
  'operations'
> & { readonly operations: () => DebateDocumentOperations };

const templateIds = documentTemplates.map((template) => template.id) as [
  TemplateId,
  ...TemplateId[],
];

const schemas = {
  list: z.object({ aiDebateId: idSchema }),
  create: z.object({
    aiDebateId: idSchema,
    folder: z.enum(['round', 'library']),
    templateId: z.enum(templateIds),
  }),
  save: z.object({
    id: idSchema,
    // The operation enforces the stored size; this only bounds the parse.
    html: z.string().max(DOCUMENT_MAX_BYTES * 2),
    expectedRevision: z.number().int().min(1).max(2_147_483_647),
  }),
  rename: z.object({ id: idSchema, title: z.string().max(400) }),
};

/** Per-person request rates; saves are autosaves while typing. */
const rules = {
  list: { windowSeconds: 60, max: 60 },
  create: { windowSeconds: 60, max: 30 },
  save: { windowSeconds: 60, max: 240 },
  rename: { windowSeconds: 60, max: 30 },
} as const;

/** Escaped HTML is up to twice its size as JSON; past that it is too large. */
const SAVE_BODY_BYTES = DOCUMENT_MAX_BYTES * 2 + 1_024;

/**
 * The `/api/debate-room/documents/*` routes. Gate order is ADR 0020's: same
 * origin, principal (session cookie), authorization (an onboarded member
 * with an actor), rate limit, then the operation, which also checks the
 * document or AI debate is the caller's own. Document content and titles
 * are private user content: they never reach a log line.
 */
export function createDebateRoomDocumentHandlers(dependencies: Dependencies) {
  const principalOf = async (
    request: Request,
    rule: keyof typeof rules,
  ): Promise<DocumentPrincipal> => {
    const identity = requireSignedIn(await dependencies.identify(request));
    if (identity.state === 'provisional') throw createAppError('AUTHORIZATION');
    const { userId } = identity.principal;
    await consumeOrThrow(
      dependencies.limiter(),
      `debate-room:${rule}:${userId}`,
      rules[rule],
    );
    const actor = await dependencies.getActorByUserId(userId);
    if (!actor) throw createAppError('INFRASTRUCTURE');
    return { userId, actorId: actor.id };
  };
  const post =
    <T>(
      name: keyof typeof rules,
      schema: z.ZodType<T>,
      maxBytes: number,
      run: (principal: DocumentPrincipal, body: T) => Promise<Response>,
    ) =>
    (request: Request) =>
      handleOperation(
        dependencies.logger,
        request,
        `debate_room.documents.${name}`,
        async () => {
          requireSameOrigin(request, dependencies.origin());
          const principal = await principalOf(request, name);
          const body = parseValidated(
            schema,
            await readJson(request, maxBytes),
          );
          return run(principal, body);
        },
      );
  const ops = () => dependencies.operations();
  return {
    list: {
      POST: post('list', schemas.list, 256, async (principal, body) =>
        Response.json({
          documents: await ops().listDocuments(principal, body),
        }),
      ),
    },
    create: {
      POST: post('create', schemas.create, 512, async (principal, body) =>
        Response.json(
          { document: await ops().createDocument(principal, body) },
          { status: 201 },
        ),
      ),
    },
    save: {
      POST: post(
        'save',
        schemas.save,
        SAVE_BODY_BYTES,
        async (principal, body) => {
          try {
            return Response.json(await ops().saveDocument(principal, body));
          } catch (error) {
            const revision = conflictRevision(error);
            if (revision === null) throw error;
            return Response.json({ revision }, { status: 409 });
          }
        },
      ),
    },
    rename: {
      POST: post('rename', schemas.rename, 2_048, async (principal, body) =>
        Response.json({
          document: await ops().renameDocument(principal, body),
        }),
      ),
    },
  };
}
