import { idSchema } from '@daisy/protocol';
import { z } from 'zod';
import { parseValidated, readJson } from '../../server/http';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
} from '../../server/member-boundary';
import {
  conflictRevision,
  type DocumentOperations,
  type DocumentPrincipal,
} from './document-operations';
import { DOCUMENT_MAX_BYTES } from './normalize-html';

/** Document routes bind their authenticated principal at the HTTP boundary. */
type Dependencies = BudgetedMemberBoundary & {
  readonly operations: () => DocumentOperations;
};

const schemas = {
  list: z.object({ roundId: idSchema }),
  create: z.object({ roundId: idSchema }),
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
 * The `/api/documents/*` routes. Gate order is ADR 0020's: same
 * origin, principal (session cookie), authorization (an onboarded member
 * with an actor), rate limit, then the operation, which also checks the
 * document or AI debate is the caller's own. Document content and titles
 * are private user content: they never reach a log line.
 */
export function createDocumentHandlers(dependencies: Dependencies) {
  const post =
    <T>(
      name: keyof typeof rules,
      schema: z.ZodType<T>,
      maxBytes: number,
      run: (principal: DocumentPrincipal, body: T) => Promise<Response>,
    ) =>
    (request: Request) =>
      runMemberRoute(
        dependencies,
        request,
        {
          name: `documents.${name}`,
          readOnly: false,
          bucket: `documents:${name}`,
          rule: rules[name],
        },
        async (principal) =>
          run(
            principal,
            parseValidated(schema, await readJson(request, maxBytes)),
          ),
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
