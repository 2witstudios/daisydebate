import type { Identity } from '@daisy/auth';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { MessagingCoreBounds } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import {
  handleOperation,
  readJson,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from '../../server/http';

type Operation = (
  input: unknown,
  principal: AuthorizationPrincipal,
) => Promise<unknown>;
type Dependencies = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly maxBodyBytes: number;
  readonly bounds: MessagingCoreBounds;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly send: Operation;
  readonly edit: Operation;
  readonly remove: Operation;
  readonly history: Operation;
  readonly changes: Operation;
  readonly markRead: Operation;
};
/** Both HTTP and native forms enter this same principal/origin boundary. */
export function createMessagingHandlers(dependencies: Dependencies) {
  const run = (
    request: Request,
    operation: keyof Pick<
      Dependencies,
      'send' | 'edit' | 'remove' | 'history' | 'changes' | 'markRead'
    >,
    input: () => Promise<unknown>,
  ) =>
    handleOperation(
      dependencies.logger,
      request,
      `messaging.${operation}`,
      async () => {
        if (operation === 'history' || operation === 'changes')
          requireSameOriginRead(request, dependencies.origin());
        else requireSameOrigin(request, dependencies.origin());
        const identity = requireSignedIn(await dependencies.identify(request));
        if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
        return Response.json(
          await dependencies[operation](await input(), identity.principal),
          {
            headers: {
              'x-messaging-message-units': String(
                dependencies.bounds.messageUnits,
              ),
              'x-messaging-page-items': String(dependencies.bounds.pageItems),
            },
          },
        );
      },
    );
  const query = (
    request: Request,
    channelId: string,
    kind: 'history' | 'changes',
  ) => {
    const params = new URL(request.url).searchParams;
    const allowed =
      kind === 'history' ? ['limit', 'before'] : ['limit', 'after'];
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
      limit: params.has('limit')
        ? number('limit')
        : dependencies.bounds.pageItems,
      ...(kind === 'history'
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
