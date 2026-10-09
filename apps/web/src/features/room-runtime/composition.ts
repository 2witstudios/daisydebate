import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { handleOperation } from '../../server/http';
import { identify } from '../../lib/identity';
import { createRoomHandlers } from './handlers';
import { createRoomRuntimeOperations } from './operations';
/** Explicit policy injection; proof choices do not silently activate production. */
export type RoomPolicy = {
  readonly consentTtlMs: number;
  readonly maxOpenRooms: number;
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
      operations: createRoomRuntimeOperations({
        store: app.database,
        redis: app.redis,
        ids: app.ids,
        consentTtlMs: () => policy.consentTtlMs,
        maxOpenRooms: () => policy.maxOpenRooms,
        botsAvailable: () => Boolean(app.config.OPENROUTER_API_KEY),
      }),
    });
    return select(handlers);
  };
  return {
    create: (request: Request) => run(request, (h) => h.create(request)),
    list: (request: Request) => run(request, (h) => h.list(request)),
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
