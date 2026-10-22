import { readRoundCommand } from './command-body';
import type { Identity } from '@daisy/auth';
import type { Logger } from '@daisy/logger';
import { createAppError } from '@daisy/errors';
import {
  idSchema,
  type RoundCommandResponse,
  type RoundView,
} from '@daisy/protocol';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import {
  refusalResponse,
  handleOperation,
  parseValidated,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from '../../server/http';
import type { createRoundRuntimeOperations } from './operations';
type Caller = { readonly userId: string; readonly actorId: string };
type Rule = { readonly max: number; readonly windowSeconds: number };
type Dependencies = {
  readonly logger: Logger;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly origin: () => string;
  readonly getActorByUserId: (
    id: string,
  ) => Promise<{ readonly id: string } | null>;
  readonly limiter: () => AuthRateLimiter;
  readonly limits: { readonly read: Rule; readonly command: Rule };
  readonly maxBodyBytes: number;
  readonly active: () => boolean;
  readonly operations: ReturnType<typeof createRoundRuntimeOperations>;
  readonly view: (caller: Caller, roundId: string) => Promise<RoundView>;
  readonly utterances: (
    caller: Caller,
    roundId: string,
    segmentId: string,
  ) => Promise<unknown>;
};

/** Shared HTTP gates for browser JSON and native POST callers; bots call the same operation server-side. */
export function createRoundHandlers(d: Dependencies) {
  const run = (
    request: Request,
    operation: 'read' | 'command',
    action: (caller: Caller) => Promise<Response>,
  ) =>
    handleOperation(
      d.logger,
      request,
      `round.${operation}`,
      async (requestId) => {
        if (!d.active()) throw createAppError('NOT_FOUND');
        if (operation === 'command') requireSameOrigin(request, d.origin());
        else requireSameOriginRead(request, d.origin());
        const identity = requireSignedIn(await d.identify(request));
        if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
        await consumeOrThrow(
          d.limiter(),
          `round:${operation}:${identity.principal.userId}`,
          d.limits[operation],
        );
        const actor = await d.getActorByUserId(identity.principal.userId);
        if (!actor || actor.id !== identity.principal.actorId)
          throw createAppError('INFRASTRUCTURE');
        try {
          return await action({
            userId: identity.principal.userId,
            actorId: actor.id,
          });
        } catch (error) {
          const response = refusalResponse(error, requestId, [
            'not-found',
            'not-authorized',
            'not-seated',
            'stale-version',
            'command-conflict',
            'illegal-command',
          ]);
          if (!response) throw error;
          return response;
        }
      },
    );
  const read = (
    request: Request,
    roundId: string,
    select: (view: RoundView) => unknown,
  ) =>
    run(request, 'read', async (caller) =>
      Response.json(
        select(await d.view(caller, parseValidated(idSchema, roundId))),
      ),
    );
  return {
    participants: (request: Request, roundId: string) =>
      read(request, roundId, (view) => ({
        roundId: view.id,
        version: view.version,
        participants: view.participants,
      })),
    segments: (request: Request, roundId: string) =>
      read(request, roundId, (view) => ({
        roundId: view.id,
        version: view.version,
        segments: view.segments,
      })),
    utterances: (request: Request, roundId: string, segmentId: string) =>
      run(request, 'read', async (caller) =>
        Response.json(
          await d.utterances(
            caller,
            parseValidated(idSchema, roundId),
            parseValidated(idSchema, segmentId),
          ),
        ),
      ),
    commands: (request: Request, roundId: string) =>
      run(request, 'command', async (caller) => {
        const id = parseValidated(idSchema, roundId);
        const { envelope, native } = await readRoundCommand(
          request,
          d.maxBodyBytes,
        );
        const receipt = await d.operations.command(
          { kind: 'human', actorId: caller.actorId },
          id,
          envelope,
        );
        const response: RoundCommandResponse = {
          receipt,
          view: await d.view(caller, id),
        };
        return native
          ? new Response(null, {
              status: 303,
              headers: { location: `/rounds/${id}` },
            })
          : Response.json(response);
      }),
  };
}
