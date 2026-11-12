import { createAppError } from '@daisy/errors';
import {
  contentReportCreateSchema,
  createMessagingCoreSchemas,
  idSchema,
} from '@daisy/protocol';
import type { z } from 'zod';
import type { OperationName } from '../../ops/operation-names';
import { contextChatReportSchema } from './report-command';
import { parseValidated, readJson } from '../../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../../server/member-boundary';

type Operation = (
  input: { readonly ownerId: string; readonly value: unknown },
  principal: import('@daisy/auth/authorization').AuthorizationPrincipal,
) => Promise<unknown>;
export type ContextChatRequestKind =
  | 'open'
  | 'discover'
  | 'history'
  | 'send'
  | 'edit'
  | 'remove'
  | 'markRead'
  | 'report';

/**
 * Every surface of a context chat enters the same origin/session boundary and
 * is bound to the owner its route names. The context supplies its operation
 * name and the open command that names its owner.
 */
export function createContextChatHandlers<Open>(
  deps: MemberBoundary & {
    /** The context's own operation name for each kind of request. */
    readonly operationName: (kind: ContextChatRequestKind) => OperationName;
    readonly open: z.ZodType<Open>;
    readonly ownerOf: (open: Open) => string;
    readonly maxBodyBytes: number;
    readonly bounds: {
      readonly messageUnits: number;
      readonly pageItems: number;
    };
    readonly websocketEndpoint?: string | null;
    readonly operations: Readonly<Record<ContextChatRequestKind, Operation>>;
  },
) {
  const schemas = createMessagingCoreSchemas(deps.bounds);
  const run = (
    request: Request,
    ownerId: string,
    kind: ContextChatRequestKind,
    input: () => Promise<unknown>,
  ) =>
    runEvaluatedRoute(deps, request, {
      name: deps.operationName(kind),
      readOnly: kind === 'discover' || kind === 'history',
      readInput: async () => ({
        ownerId: parseValidated(idSchema, ownerId),
        value: await input(),
      }),
      operation: (input, principal) =>
        deps.operations[kind](
          input as { ownerId: string; value: unknown },
          principal,
        ),
      headers: {
        'x-messaging-message-units': String(deps.bounds.messageUnits),
        'x-messaging-page-items': String(deps.bounds.pageItems),
        ...(deps.websocketEndpoint
          ? { 'x-realtime-socket-url': deps.websocketEndpoint }
          : {}),
      },
    });
  const mutation =
    (kind: 'send' | 'edit' | 'remove' | 'markRead') =>
    (request: Request, ownerId: string) =>
      run(request, ownerId, kind, async () =>
        parseValidated(
          schemas[kind] as z.ZodType<unknown>,
          await readJson(request, deps.maxBodyBytes),
        ),
      );
  return {
    open: (request: Request, ownerId: string) =>
      run(request, ownerId, 'open', async () => {
        const value = parseValidated(
          deps.open,
          await readJson(request, deps.maxBodyBytes),
        );
        if (deps.ownerOf(value) !== ownerId) throw createAppError('VALIDATION');
        return value;
      }),
    discover: (request: Request, ownerId: string) =>
      run(request, ownerId, 'discover', async () => null),
    history: (request: Request, ownerId: string) =>
      run(request, ownerId, 'history', async () => {
        const query = new URL(request.url).searchParams;
        for (const key of query.keys())
          if (
            !['channelId', 'limit', 'before'].includes(key) ||
            query.getAll(key).length !== 1
          )
            throw createAppError('VALIDATION');
        const channelId = query.get('channelId');
        return parseValidated(schemas.history, {
          version: 1,
          channelId,
          limit: query.has('limit')
            ? Number(query.get('limit'))
            : Math.min(deps.bounds.pageItems, 50),
          ...(query.has('before')
            ? { before: { channelId, sequence: Number(query.get('before')) } }
            : {}),
        });
      }),
    send: mutation('send'),
    edit: mutation('edit'),
    remove: mutation('remove'),
    markRead: mutation('markRead'),
    report: (request: Request, ownerId: string) =>
      run(request, ownerId, 'report', async () => {
        const value = parseValidated(
          contextChatReportSchema,
          await readJson(request, deps.maxBodyBytes),
        );
        const report = parseValidated(contentReportCreateSchema, {
          targetKind: 'chat_message',
          targetId: value.messageId,
          reason: value.reason,
        });
        if (report.targetKind !== 'chat_message')
          throw createAppError('VALIDATION');
        return { ...value, reason: report.reason };
      }),
  };
}
