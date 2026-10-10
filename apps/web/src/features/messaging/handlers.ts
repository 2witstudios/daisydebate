import type { Identity } from '@daisy/auth';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { MessagingCoreBounds } from '@daisy/protocol';
import type { Logger } from '@daisy/logger';
import { createAppError } from '@daisy/errors';
import { readJson } from '../../server/http';
import { runMessagingHandler } from './handler-boundary';

type Operation = (
  input: unknown,
  principal: AuthorizationPrincipal,
) => Promise<unknown>;
type Dependencies = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly maxBodyBytes: number;
  readonly bounds: MessagingCoreBounds;
  readonly websocketEndpoint?: string | null;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly send: Operation;
  readonly edit: Operation;
  readonly remove: Operation;
  readonly history: Operation;
  readonly search: Operation;
  readonly changes: Operation;
  readonly markRead: Operation;
};
/** Both HTTP and native forms enter this same principal/origin boundary. */
export function createMessagingHandlers(dependencies: Dependencies) {
  const run = (
    request: Request,
    operation: keyof Pick<
      Dependencies,
      'send' | 'edit' | 'remove' | 'history' | 'search' | 'changes' | 'markRead'
    >,
    input: () => Promise<unknown>,
  ) =>
    runMessagingHandler(dependencies, request, {
      name: `messaging.${operation}`,
      readOnly:
        operation === 'history' ||
        operation === 'search' ||
        operation === 'changes',
      readInput: input,
      operation: dependencies[operation],
      headers: {
        'x-messaging-message-units': String(dependencies.bounds.messageUnits),
        'x-messaging-page-items': String(dependencies.bounds.pageItems),
        ...(dependencies.websocketEndpoint
          ? { 'x-realtime-socket-url': dependencies.websocketEndpoint }
          : {}),
      },
    });
  const query = (
    request: Request,
    channelId: string,
    kind: 'history' | 'search' | 'changes',
  ) => {
    const params = new URL(request.url).searchParams;
    const allowed =
      kind === 'changes'
        ? ['limit', 'after']
        : kind === 'search'
          ? ['limit', 'before', 'query']
          : ['limit', 'before'];
    if (
      [...params.keys()].some(
        (key) => !allowed.includes(key) || params.getAll(key).length !== 1,
      )
    )
      throw createAppError('VALIDATION');
    const number = (key: string) => {
      const value = params.get(key);
      return value !== null && /^\d+$/.test(value) ? Number(value) : undefined;
    };
    return {
      version: 1,
      channelId,
      ...(kind === 'search' ? { query: params.get('query') } : {}),
      limit: params.has('limit')
        ? number('limit')
        : dependencies.bounds.pageItems,
      ...(kind !== 'changes'
        ? params.has('before')
          ? { before: { channelId, sequence: number('before') } }
          : {}
        : { after: { channelId, changeVersion: number('after') } }),
    };
  };
  return {
    edit: (request: Request) =>
      run(request, 'edit', () => readJson(request, dependencies.maxBodyBytes)),
    remove: (request: Request) =>
      run(request, 'remove', () =>
        readJson(request, dependencies.maxBodyBytes),
      ),
    send: (request: Request) =>
      run(request, 'send', () => readJson(request, dependencies.maxBodyBytes)),
    search: (request: Request, channelId: string) =>
      run(request, 'search', async () => query(request, channelId, 'search')),
    history: (request: Request, channelId: string) =>
      run(request, 'history', async () => query(request, channelId, 'history')),
    changes: (request: Request, channelId: string) =>
      run(request, 'changes', async () => query(request, channelId, 'changes')),
    markRead: (request: Request) =>
      run(request, 'markRead', () =>
        readJson(request, dependencies.maxBodyBytes),
      ),
  };
}
