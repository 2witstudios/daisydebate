import type { Identity } from '@daisy/auth';
import { createAppError, isAppError, toPublicError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import { idSchema, roomCommandSchema, roomCreateSchema } from '@daisy/protocol';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from '../../server/http';
import type { RoomRuntimeOperations } from './operations';

type Rule = { readonly max: number; readonly windowSeconds: number };
type Dependencies = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly getActorByUserId: (
    userId: string,
  ) => Promise<{ readonly id: string } | null>;
  readonly operations: RoomRuntimeOperations;
  readonly active: () => boolean;
  readonly maxBodyBytes: number;
  readonly limiter: () => AuthRateLimiter;
  readonly limits: {
    readonly create: Rule;
    readonly read: Rule;
    readonly command: Rule;
  };
};
/** Canonical HTTP gates also execute for native form callers through inProcessFetch. */
export function createRoomHandlers(dependencies: Dependencies) {
  const callerOf = async (
    request: Request,
    operation: keyof Dependencies['limits'],
  ) => {
    const identity = requireSignedIn(await dependencies.identify(request));
    if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
    await consumeOrThrow(
      dependencies.limiter(),
      `room:${operation}:${identity.principal.userId}`,
      dependencies.limits[operation],
    );
    const actor = await dependencies.getActorByUserId(
      identity.principal.userId,
    );
    if (!actor || actor.id !== identity.principal.actorId)
      throw createAppError('INFRASTRUCTURE');
    return { userId: identity.principal.userId, actorId: actor.id };
  };
  const run = (
    request: Request,
    operation: keyof Dependencies['limits'],
    mutate: boolean,
    action: (caller: Awaited<ReturnType<typeof callerOf>>) => Promise<unknown>,
  ) =>
    handleOperation(
      dependencies.logger,
      request,
      `room.${operation}`,
      async (requestId) => {
        if (!dependencies.active()) throw createAppError('NOT_FOUND');
        if (mutate) requireSameOrigin(request, dependencies.origin());
        else requireSameOriginRead(request, dependencies.origin());
        const caller = await callerOf(request, operation);
        try {
          return Response.json(await action(caller), {
            status: operation === 'create' ? 201 : 200,
          });
        } catch (error) {
          // Refusal reasons are closed domain vocabulary; public errors never expose exception details.
          const reasons = [
            'version-conflict',
            'host-required',
            'room-closed',
            'illegal-config',
            'seat-unavailable',
            'actor-ineligible',
            'not-seated',
            'incomplete-cast',
            'not-ready',
            'readiness-unavailable',
            'prep-running',
            'prep-unavailable',
            'command-conflict',
            'consent-conflict',
          ];
          if (!isAppError(error) || !reasons.includes(error.message))
            throw error;
          const mapped = toPublicError(error, requestId);
          return Response.json(
            { ...mapped.body, refusal: error.message },
            { status: mapped.status },
          );
        }
      },
    );
  return {
    create: (request: Request) =>
      run(request, 'create', true, async (caller) =>
        dependencies.operations.create(
          caller,
          parseValidated(
            roomCreateSchema,
            await readJson(request, dependencies.maxBodyBytes),
          ),
        ),
      ),
    list: (request: Request) =>
      run(request, 'read', false, async (caller) => ({
        rooms: await dependencies.operations.list(caller),
      })),
    catalog: (request: Request) =>
      run(request, 'read', false, async (caller) => ({
        choices: await dependencies.operations.catalog(caller),
        bots: await dependencies.operations.castChoices(caller),
      })),
    read: (request: Request, roomId: string) =>
      run(request, 'read', false, (caller) =>
        dependencies.operations.view(caller, parseValidated(idSchema, roomId)),
      ),
    commands: (request: Request, roomId: string) =>
      run(request, 'command', true, async (caller) =>
        dependencies.operations.command(
          caller,
          parseValidated(idSchema, roomId),
          parseValidated(
            roomCommandSchema,
            await readJson(request, dependencies.maxBodyBytes),
          ),
        ),
      ),
    roundRead: (request: Request, roundId: string) =>
      run(request, 'read', false, (caller) =>
        dependencies.operations.roundView(
          caller,
          parseValidated(idSchema, roundId),
        ),
      ),
    roundRef: (request: Request, roomId: string) =>
      run(request, 'read', false, async (caller) => {
        const view = await dependencies.operations.view(
          caller,
          parseValidated(idSchema, roomId),
        );
        if (!view.roundRef) throw createAppError('NOT_FOUND');
        return view.roundRef;
      }),
  };
}
