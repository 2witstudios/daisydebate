import { defineComposition } from '../../server/composition';
import { liveLinkedAdults } from '../spectating/linked-adults';
import { trackRequest } from '../analytics/track-request';
import { createRoomDraftHandler } from '../rooms/create-room-draft-handler';
import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { handleOperation } from '../../server/http';
import { memberHttpBoundary } from '../auth/member-boundary';
import { createRoomHandlers } from './handlers';
import { createRoomRuntimeOperations } from './operations';
import { drawEntropy } from './entropy';
import { routeReleaseFor } from '../flags/route-release';
import { releaseAdmission } from '../flags/admission';
import { releaseFlagDefault } from '../flags/release-default';
function composeRoomRoutes(app: App) {
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
        app.reporter,
      );
    const policy = app.roomPolicy;
    handlers ??= createRoomHandlers({
      ...memberHttpBoundary(app),
      maxBodyBytes: policy.maxBodyBytes,
      limits: policy.limits,
      websocketEndpoint: app.websocketEndpoint,
      operations: createRoomRuntimeOperations({
        store: app.database,
        redis: app.redis,
        ids: app.ids,

        consentTtlMs: () => policy.consentTtlMs,
        aiSeats: () => app.aiSeats,
        botDebatesReleased: (userId) =>
          routeReleaseFor(app)('bot-debates', userId),
        botRelease: releaseAdmission(
          'bot-debates',
          releaseFlagDefault(app.config),
        ),
        betaGrantsPremium: app.config.PREMIUM_BETA_GRANT,
        entropy: drawEntropy,
        linkedAdults: liveLinkedAdults(app),
      }),
    });
    return select(handlers);
  };
  const routes = {
    create: async (request: Request) => {
      const response = await run(request, (h) => h.create(request));
      if (response.ok)
        await trackRequest(app, request, {
          event: 'room_created',
          properties: {},
        });
      return response;
    },
    rematch: async (request: Request, roomId: string) => {
      const response = await run(request, (h) => h.rematch(request, roomId));
      if (response.ok)
        await trackRequest(app, request, {
          event: 'room_rematched',
          properties: {},
        });
      return response;
    },
    list: (request: Request) => run(request, (h) => h.list(request)),
    active: (request: Request) => run(request, (h) => h.active(request)),
    hosted: (request: Request) => run(request, (h) => h.hosted(request)),
    catalog: (request: Request) => run(request, (h) => h.catalog(request)),
    read: (request: Request, roomId: string) =>
      run(request, (h) => h.read(request, roomId)),
    commands: (request: Request, roomId: string) =>
      run(request, (h) => h.commands(request, roomId)),
  };
  return {
    ...routes,
    submitDraft: createRoomDraftHandler({
      ...memberHttpBoundary(app),
      store: app.redis,
      catalog: routes.catalog,
      create: routes.create,
      rematch: routes.rematch,
    }),
  };
}

/** rooms: its route files bind here (`processRoute`). */
export const roomComposition = defineComposition('rooms', (app) =>
  composeRoomRoutes(app),
);
