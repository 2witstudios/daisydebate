import { createAppError, isAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import {
  idSchema,
  roomCommandSchema,
  roomCreateSchema,
  roomListQuerySchema,
  roomRefusalSchema,
} from '@daisy/protocol';
import type { RateRule } from '../../server/rate-limit';
import {
  refusalResponse,
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
  requireSameOriginRead,
} from '../../server/http';
import {
  requireMember,
  type MemberCaller,
  type MemberGateDependencies,
} from '../../server/member-gate';
import type { RoomRuntimeOperations } from './operations';

type Dependencies = MemberGateDependencies & {
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from these handlers' raw errors goes, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly operations: RoomRuntimeOperations;
  readonly active: () => boolean;
  readonly maxBodyBytes: number;
  readonly limits: {
    readonly create: RateRule;
    readonly read: RateRule;
    readonly command: RateRule;
  };
  /** Named on room reads, where their doorbell rings. */
  readonly websocketEndpoint?: string | null;
};
/** Canonical HTTP gates also execute for native form callers through inProcessFetch. */
export function createRoomHandlers(dependencies: Dependencies) {
  const run = (
    request: Request,
    operation: keyof Dependencies['limits'],
    mutate: boolean,
    action: (caller: MemberCaller) => Promise<unknown>,
    headers: Readonly<Record<string, string>> = {},
  ) =>
    handleOperation(
      dependencies.logger,
      request,
      `room.${operation}`,
      async (requestId) => {
        if (!dependencies.active()) throw createAppError('NOT_FOUND');
        if (mutate) requireSameOrigin(request, dependencies.origin());
        else requireSameOriginRead(request, dependencies.origin());
        const caller = await requireMember(dependencies, request, {
          bucket: `room:${operation}`,
          rule: dependencies.limits[operation],
          // A waitlisted account may command, where the evaluator keeps only
          // its withdrawals (leaving, ADR 0075); reads and creation stay
          // member-only.
          admitWaitlisted: operation === 'command',
        });
        try {
          return Response.json(await action(caller), {
            status: operation === 'create' ? 201 : 200,
            headers,
          });
        } catch (error) {
          // Refusal reasons are closed domain vocabulary; public errors never expose exception details.
          const response = refusalResponse(
            error,
            requestId,
            roomRefusalSchema.options,
          );
          if (!response) throw error;
          if (isAppError(error) && error.reason === 'active-room')
            // The caller's own Room, so the UI can return them to it.
            return Response.json(
              {
                ...(await response.json()),
                activeRoom: await dependencies.operations.activeRoom(caller),
              },
              { status: response.status },
            );
          return response;
        }
      },
      dependencies.reporter,
    );
  const doorbell = dependencies.websocketEndpoint
    ? { 'x-realtime-socket-url': dependencies.websocketEndpoint }
    : {};
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
    rematch: (request: Request, sourceRoomId: string) =>
      run(request, 'create', true, async (caller) =>
        dependencies.operations.rematch(
          caller,
          parseValidated(idSchema, sourceRoomId),
          parseValidated(
            roomCreateSchema,
            await readJson(request, dependencies.maxBodyBytes),
          ),
        ),
      ),
    list: (request: Request) =>
      run(request, 'read', false, async (caller) => {
        const params = new URL(request.url).searchParams;
        if (new Set(params.keys()).size !== [...params.keys()].length)
          throw createAppError('VALIDATION');
        const raw = Object.fromEntries(params);
        return dependencies.operations.list(
          caller,
          parseValidated(roomListQuerySchema, {
            ...raw,
            ...(raw.pageSize === undefined
              ? {}
              : {
                  pageSize: /^(?:[1-9]|[1-4][0-9]|50)$/.test(raw.pageSize)
                    ? Number(raw.pageSize)
                    : NaN,
                }),
          }),
        );
      }),
    active: (request: Request) =>
      run(request, 'read', false, async (caller) => ({
        activeRoom: await dependencies.operations.activeRoom(caller),
      })),
    catalog: (request: Request) =>
      run(request, 'read', false, async (caller) => ({
        ...(await dependencies.operations.catalog(caller)),
        bots: await dependencies.operations.castChoices(caller),
      })),
    read: (request: Request, roomId: string) =>
      run(
        request,
        'read',
        false,
        (caller) =>
          dependencies.operations.view(
            caller,
            parseValidated(idSchema, roomId),
          ),
        doorbell,
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
  };
}
