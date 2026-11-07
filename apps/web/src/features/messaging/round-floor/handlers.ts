import { createAppError } from '@daisy/errors';
import { contentReportCreateSchema, idSchema } from '@daisy/protocol';
import { createRoundFloorSchemas } from '@daisy/protocol/round-floor';
import { z } from 'zod';
import { parseValidated, readJson } from '../../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../../server/member-boundary';

type Operation = (
  input: { readonly roundId: string; readonly value: unknown },
  principal: import('@daisy/auth/authorization').AuthorizationPrincipal,
) => Promise<unknown>;
type Kind =
  | 'open'
  | 'discover'
  | 'history'
  | 'send'
  | 'edit'
  | 'remove'
  | 'markRead'
  | 'report';
const reportInput = z.strictObject({
  version: z.literal(1),
  channelId: idSchema,
  messageId: idSchema,
  reason: z.string(),
});

/** Every floor surface enters the same origin/session boundary and bound Round scope. */
export function createFloorHandlers(
  deps: MemberBoundary & {
    readonly maxBodyBytes: number;
    readonly bounds: {
      readonly messageUnits: number;
      readonly pageItems: number;
    };
    readonly websocketEndpoint?: string | null;
    readonly operations: Readonly<Record<Kind, Operation>>;
  },
) {
  const schemas = createRoundFloorSchemas(deps.bounds);
  const run = (
    request: Request,
    roundId: string,
    kind: Kind,
    input: () => Promise<unknown>,
  ) =>
    runEvaluatedRoute(deps, request, {
      name: `messaging.floor.${kind}`,
      readOnly: kind === 'discover' || kind === 'history',
      readInput: async () => ({
        roundId: parseValidated(idSchema, roundId),
        value: await input(),
      }),
      operation: (input, principal) =>
        deps.operations[kind](
          input as { roundId: string; value: unknown },
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
    (request: Request, roundId: string) =>
      run(request, roundId, kind, async () =>
        parseValidated(
          schemas[kind] as z.ZodType<unknown>,
          await readJson(request, deps.maxBodyBytes),
        ),
      );
  return {
    open: (request: Request, roundId: string) =>
      run(request, roundId, 'open', async () => {
        const value = parseValidated(
          schemas.open,
          await readJson(request, deps.maxBodyBytes),
        );
        if (value.roundId !== roundId) throw createAppError('VALIDATION');
        return value;
      }),
    discover: (request: Request, roundId: string) =>
      run(request, roundId, 'discover', async () => null),
    history: (request: Request, roundId: string) =>
      run(request, roundId, 'history', async () => {
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
    report: (request: Request, roundId: string) =>
      run(request, roundId, 'report', async () => {
        const value = parseValidated(
          reportInput,
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
