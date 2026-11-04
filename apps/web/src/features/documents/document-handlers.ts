import { idSchema } from '@daisy/protocol';
import { isAppError } from '@daisy/errors';
import { z } from 'zod';
import { parseValidated, readBytes, readJson } from '../../server/http';
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
import { DOCUMENT_READ_MAX } from '@daisy/db/documents';
import { driveNoticeOf, returnPath } from './drive-return';

/** Document routes bind their authenticated principal at the HTTP boundary. */
type Dependencies = BudgetedMemberBoundary & {
  readonly operations: () => DocumentOperations;
};

/** A form's empty folder choice is the drive's root. */
const folderChoice = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  idSchema.nullable(),
);
/** Postgres refuses U+0000 and no name needs a control character. */
const label = z
  .string()
  .max(400)
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]*$/);

const schemas = {
  list: z.object({
    folderId: idSchema.nullable(),
    after: z
      .object({
        kind: z.enum(['folder', 'document']),
        label,
        id: idSchema,
      })
      .nullable(),
  }),
  read: z.object({ ids: z.array(idSchema).max(DOCUMENT_READ_MAX) }),
  recent: z.object({}),
  folders: z.object({}),
  search: z.object({
    text: z.string().max(400),
    page: z.number().int().min(0).max(10),
  }),
  save: z.object({
    id: idSchema,
    // The operation enforces the stored size; this only bounds the parse.
    html: z.string().max(DOCUMENT_MAX_BYTES * 2),
    expectedRevision: z.number().int().min(1).max(2_147_483_647),
  }),
  create: z.object({ folderId: folderChoice }),
  rename: z.object({ id: idSchema, title: label }),
  move: z.object({ id: idSchema, folderId: folderChoice }),
  delete: z.object({ id: idSchema }),
  folderCount: z.object({ id: idSchema }),
  folderCreate: z.object({ parentFolderId: folderChoice, name: label }),
  folderRename: z.object({ id: idSchema, name: label }),
  folderMove: z.object({ id: idSchema, parentFolderId: folderChoice }),
  folderDelete: z.object({ id: idSchema }),
};

/** Per-person request rates; saves are autosaves while typing. */
const rules = {
  list: { windowSeconds: 60, max: 120 },
  read: { windowSeconds: 60, max: 120 },
  recent: { windowSeconds: 60, max: 60 },
  folders: { windowSeconds: 60, max: 60 },
  search: { windowSeconds: 60, max: 120 },
  save: { windowSeconds: 60, max: 240 },
  create: { windowSeconds: 60, max: 30 },
  rename: { windowSeconds: 60, max: 30 },
  move: { windowSeconds: 60, max: 60 },
  delete: { windowSeconds: 60, max: 30 },
  folderCount: { windowSeconds: 60, max: 60 },
  folderCreate: { windowSeconds: 60, max: 30 },
  folderRename: { windowSeconds: 60, max: 30 },
  folderMove: { windowSeconds: 60, max: 60 },
  folderDelete: { windowSeconds: 60, max: 30 },
} as const;

const operationNames = {
  list: 'documents.list',
  read: 'documents.read',
  recent: 'documents.recent',
  folders: 'documents.folders',
  search: 'documents.search',
  save: 'documents.save',
  create: 'documents.create',
  rename: 'documents.rename',
  move: 'documents.move',
  delete: 'documents.delete',
  folderCount: 'documents.folder_count',
  folderCreate: 'documents.folder_create',
  folderRename: 'documents.folder_rename',
  folderMove: 'documents.folder_move',
  folderDelete: 'documents.folder_delete',
} as const;

/** Escaped HTML is up to twice its size as JSON; past that it is too large. */
const SAVE_BODY_BYTES = DOCUMENT_MAX_BYTES * 2 + 1_024;
const SMALL_BODY_BYTES = 2_048;

const isForm = (request: Request) =>
  (request.headers.get('content-type') ?? '').startsWith(
    'application/x-www-form-urlencoded',
  );

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location } });

/**
 * The `/api/documents/*` routes. Gate order is ADR 0020's: same origin, principal
 * (session cookie), authorization (only an admitted member passes, so a closed,
 * restricted, revoked or under-age account reaches none of them), rate limit,
 * then the operation, which also checks the document is the caller's own.
 * Document content, titles and search words are private user content: they never
 * reach a log line. A change posts either JSON or a plain form, the same route:
 * a form answers with a 303 back to the page it came from, so it works without
 * JavaScript, and a refusal returns a fixed notice key, never a typed value.
 */
export function createDocumentHandlers(dependencies: Dependencies) {
  const route =
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
          name: operationNames[name],
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
  const change =
    <T>(
      name: keyof typeof rules,
      schema: z.ZodType<T>,
      run: (principal: DocumentPrincipal, body: T) => Promise<unknown>,
    ) =>
    async (request: Request) => {
      const response = await runMemberRoute(
        dependencies,
        request,
        {
          name: operationNames[name],
          readOnly: false,
          bucket: `documents:${name}`,
          rule: rules[name],
        },
        async (principal) => {
          if (!isForm(request)) {
            const body = parseValidated(
              schema,
              await readJson(request, SMALL_BODY_BYTES),
            );
            return Response.json((await run(principal, body)) ?? {}, {
              status: name === 'create' || name === 'folderCreate' ? 201 : 200,
            });
          }
          const form = new URLSearchParams(
            new TextDecoder().decode(
              await readBytes(request, SMALL_BODY_BYTES),
            ),
          );
          const back = returnPath(form.get('back'));
          try {
            await run(
              principal,
              parseValidated(schema, Object.fromEntries(form)),
            );
            return seeOther(back);
          } catch (error) {
            if (!isAppError(error) || error.code === 'INFRASTRUCTURE')
              throw error;
            // The only conflict a new document can meet is a full drive.
            const notice =
              name === 'create' && error.code === 'CONFLICT'
                ? 'drive-full'
                : driveNoticeOf(error);
            return seeOther(`${back}?notice=${notice}`);
          }
        },
      );
      // A gate or the rate limit refused a plain form before it was read: a person
      // without script gets a page and a fixed notice, never raw JSON.
      return isForm(request) && response.status >= 400 && response.status < 500
        ? seeOther('/prep?notice=refused')
        : response;
    };
  const ops = () => dependencies.operations();
  return {
    list: {
      POST: route('list', schemas.list, 1_024, async (principal, body) =>
        Response.json(await ops().listDrive(principal, body)),
      ),
    },
    read: {
      POST: route('read', schemas.read, 1_024, async (principal, body) =>
        Response.json({
          documents: await ops().readDocuments(principal, body),
        }),
      ),
    },
    recent: {
      POST: route('recent', schemas.recent, 64, async (principal) =>
        Response.json(await ops().recent(principal)),
      ),
    },
    folders: {
      POST: route('folders', schemas.folders, 64, async (principal) =>
        Response.json({ folders: await ops().listFolders(principal) }),
      ),
    },
    search: {
      POST: route('search', schemas.search, 1_024, async (principal, body) =>
        Response.json({ hits: await ops().search(principal, body) }),
      ),
    },
    save: {
      POST: route(
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
    create: {
      POST: change('create', schemas.create, async (principal, body) => ({
        document: await ops().createDocument(principal, body),
      })),
    },
    rename: {
      POST: change('rename', schemas.rename, (principal, body) =>
        ops().renameDocument(principal, body),
      ),
    },
    move: {
      POST: change('move', schemas.move, (principal, body) =>
        ops().moveDocument(principal, body),
      ),
    },
    delete: {
      POST: change('delete', schemas.delete, (principal, body) =>
        ops().deleteDocument(principal, body),
      ),
    },
    folderCount: {
      POST: route(
        'folderCount',
        schemas.folderCount,
        128,
        async (principal, body) =>
          Response.json({
            count: await ops().folderDocumentCount(principal, body),
          }),
      ),
    },
    folderCreate: {
      POST: change(
        'folderCreate',
        schemas.folderCreate,
        async (principal, body) => ({
          folder: await ops().createFolder(principal, body),
        }),
      ),
    },
    folderRename: {
      POST: change('folderRename', schemas.folderRename, (principal, body) =>
        ops().renameFolder(principal, body),
      ),
    },
    folderMove: {
      POST: change('folderMove', schemas.folderMove, (principal, body) =>
        ops().moveFolder(principal, body),
      ),
    },
    folderDelete: {
      POST: change('folderDelete', schemas.folderDelete, (principal, body) =>
        ops().deleteFolder(principal, body),
      ),
    },
  };
}
