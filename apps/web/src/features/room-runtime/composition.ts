import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { handleOperation } from '../../server/http';
import { identify } from '../../lib/identity';
import { createRoomHandlers } from './handlers';
import { createRoomRuntimeOperations } from './operations';
import { drawEntropy } from './entropy';
/** Explicit policy injection; proof choices do not silently activate production. */
export type RoomPolicy = {
  readonly consentTtlMs: number;
  /** How long an open Room may go without a command before maintenance closes it; absent leaves expiry inert (ADR 0070). */
  readonly idleTimeoutMs?: number;
  readonly maxBodyBytes: number;
  readonly limits: Parameters<typeof createRoomHandlers>[0]['limits'];
};
export function composeRoomRoutes(app: App) {
  let handlers: ReturnType<typeof createRoomHandlers> | undefined;
  const run = (
    request: Request,
    select: (
      handlers: ReturnType<typeof createRoomHandlers>,
    ) => Promise<Response>,
  ) => {
    if (!app.roomPolicy)
      return handleOperation(
        app.logger,
        request,
        'room.unavailable',
        async () => {
          throw createAppError('NOT_FOUND');
        },
      );
    const policy = app.roomPolicy;
    handlers ??= createRoomHandlers({
      logger: app.logger,
      origin: () => app.auth().config.PUBLIC_APP_URL,
      identify: (request) => identify(app.auth(), request.headers),
      getActorByUserId: (userId) => app.database.getActorByUserId(userId),
      limiter: () => app.auth().limiter,
      active: () => true,
      maxBodyBytes: policy.maxBodyBytes,
      limits: policy.limits,
      websocketEndpoint: app.websocketEndpoint,
      operations: createRoomRuntimeOperations({
        store: app.database,
        redis: app.redis,
        ids: app.ids,
        consentTtlMs: () => policy.consentTtlMs,
        botsAvailable: () => Boolean(app.config.OPENROUTER_API_KEY),
        entropy: drawEntropy,
      }),
    });
    return select(handlers);
  };
  return {
    create: (request: Request) => run(request, (h) => h.create(request)),
    rematch: (request: Request, roomId: string) =>
      run(request, (h) => h.rematch(request, roomId)),
    list: (request: Request) => run(request, (h) => h.list(request)),
    active: (request: Request) => run(request, (h) => h.active(request)),
    catalog: (request: Request) => run(request, (h) => h.catalog(request)),
    read: (request: Request, roomId: string) =>
      run(request, (h) => h.read(request, roomId)),
    commands: (request: Request, roomId: string) =>
      run(request, (h) => h.commands(request, roomId)),
    roundRef: (request: Request, roomId: string) =>
      run(request, (h) => h.roundRef(request, roomId)),
    roundRead: (request: Request, roundId: string) =>
      run(request, (h) => h.roundRead(request, roundId)),
  };
}
