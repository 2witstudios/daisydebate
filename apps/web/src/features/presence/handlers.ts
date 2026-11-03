import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import {
  peopleQuerySchema,
  peopleListSchema,
  presenceSettingResultSchema,
  presenceSettingSchema,
  type ChosenStatus,
  type PeopleFilter,
  type PeopleList,
} from '@daisy/protocol';
import { parseValidated, readJson } from '../../server/http';
import {
  runMemberHandler,
  type MemberBoundary,
} from '../../server/member-handler';

const MAX_BODY_BYTES = 1024;

type Answer = Promise<{ readonly status: ChosenStatus }>;

/** The member's own status, and the people list as they may see it (ADR 0105). */
export function createPresenceHandlers(dependencies: {
  readonly boundary: MemberBoundary;
  /** Where browsers open the socket that rings them; null without realtime. */
  readonly websocketEndpoint: string | null;
  readonly set: (
    principal: AuthorizationPrincipal,
    status: ChosenStatus,
  ) => Answer;
  readonly read: (principal: AuthorizationPrincipal) => Answer;
  readonly people: (
    principal: AuthorizationPrincipal,
    input: {
      readonly filter: PeopleFilter;
      readonly query: string | null;
      readonly cursor: string | undefined;
    },
  ) => Promise<Omit<PeopleList, 'version'>>;
}) {
  return {
    people: (request: Request) =>
      runMemberHandler(dependencies.boundary, request, {
        name: 'presence.people',
        readOnly: true,
        readInput: async () =>
          parseValidated(
            peopleQuerySchema,
            Object.fromEntries(new URL(request.url).searchParams),
          ),
        operation: async (input, principal) => {
          const query = input as ReturnType<typeof peopleQuerySchema.parse>;
          return peopleListSchema.parse({
            version: 1,
            ...(await dependencies.people(principal, {
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
      runMemberHandler(dependencies.boundary, request, {
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
      runMemberHandler(dependencies.boundary, request, {
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
