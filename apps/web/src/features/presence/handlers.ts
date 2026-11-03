import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import {
  onlineQuerySchema,
  onlineRosterSchema,
  presenceSettingResultSchema,
  presenceSettingSchema,
  type ChosenStatus,
  type OnlineFilter,
  type OnlineRoster,
} from '@daisy/protocol';
import { parseValidated, readJson } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';

const MAX_BODY_BYTES = 1024;

type Answer = Promise<{ readonly status: ChosenStatus }>;

/** The member's own status, and who is online as they may see it (ADR 0103). */
export function createPresenceHandlers(dependencies: {
  readonly boundary: MemberBoundary;
  /** Where browsers open the socket that rings them; null without realtime. */
  readonly websocketEndpoint: string | null;
  readonly set: (
    principal: AuthorizationPrincipal,
    status: ChosenStatus,
  ) => Answer;
  readonly read: (principal: AuthorizationPrincipal) => Answer;
  readonly online: (
    principal: AuthorizationPrincipal,
    input: {
      readonly filter: OnlineFilter;
      readonly query: string | null;
      readonly cursor: string | undefined;
    },
  ) => Promise<Omit<OnlineRoster, 'version'>>;
}) {
  return {
    online: (request: Request) =>
      runEvaluatedRoute(dependencies.boundary, request, {
        name: 'presence.online',
        readOnly: true,
        readInput: async () =>
          parseValidated(
            onlineQuerySchema,
            Object.fromEntries(new URL(request.url).searchParams),
          ),
        operation: async (input, principal) => {
          const query = input as ReturnType<typeof onlineQuerySchema.parse>;
          return onlineRosterSchema.parse({
            version: 1,
            ...(await dependencies.online(principal, {
              filter: query.filter,
              query: query.q ? query.q.replace(/^@/, '') : null,
              cursor: query.cursor,
            })),
          });
        },
        headers: {
          'cache-control': 'no-store',
          ...(dependencies.websocketEndpoint
            ? { 'x-realtime-socket-url': dependencies.websocketEndpoint }
            : {}),
        },
      }),
    read: (request: Request) =>
      runEvaluatedRoute(dependencies.boundary, request, {
        name: 'presence.read',
        readOnly: true,
        readInput: async () => null,
        operation: async (_input, principal) =>
          presenceSettingResultSchema.parse({
            version: 1,
            ...(await dependencies.read(principal)),
          }),
      }),
    set: (request: Request) =>
      runEvaluatedRoute(dependencies.boundary, request, {
        name: 'presence.set',
        readOnly: false,
        readInput: () => readJson(request, MAX_BODY_BYTES),
        operation: async (input, principal) =>
          presenceSettingResultSchema.parse({
            version: 1,
            ...(await dependencies.set(
              principal,
              parseValidated(presenceSettingSchema, input).status,
            )),
          }),
      }),
  };
}
