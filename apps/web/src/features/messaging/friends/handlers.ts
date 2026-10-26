import type { Identity } from '@daisy/auth';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Logger } from '@daisy/logger';
import {
  friendCommandResultSchema,
  friendCommandSchemas,
  friendListSchema,
  onlineCountsSchema,
  type FriendCommandResult,
  type FriendList,
  type OnlineCounts,
} from '@daisy/protocol';
import type { FriendshipCommand } from './friendship';
import { parseValidated, readJson } from '../../../server/http';
import { runMessagingHandler } from '../handler-boundary';

const MAX_BODY_BYTES = 1024;

type Boundary = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly identify: (request: Request) => Promise<Identity>;
};

/**
 * The friend routes (ADR 0071): same-origin, member-only, a bounded JSON
 * body naming the other member by username. A form posts through the same
 * handler in process.
 */
export function createFriendHandlers(dependencies: {
  readonly boundary: Boundary;
  readonly change: (
    principal: AuthorizationPrincipal,
    command: FriendshipCommand,
    username: string,
  ) => Promise<Omit<FriendCommandResult, 'version'>>;
  readonly list: (
    principal: AuthorizationPrincipal,
  ) => Promise<Omit<FriendList, 'version'>>;
  readonly counts: (
    principal: AuthorizationPrincipal,
  ) => Promise<Omit<OnlineCounts, 'version'>>;
  /** Named on the counts read, so the shell can open its presence socket. */
  readonly websocketEndpoint: string | null;
}) {
  const write = (
    request: Request,
    name: string,
    command: (input: unknown) => {
      readonly command: FriendshipCommand;
      readonly username: string;
    },
  ) =>
    runMessagingHandler(dependencies.boundary, request, {
      name: `friends.${name}`,
      readOnly: false,
      readInput: () => readJson(request, MAX_BODY_BYTES),
      operation: async (input, principal) => {
        const parsed = command(input);
        return friendCommandResultSchema.parse({
          version: 1,
          ...(await dependencies.change(
            principal,
            parsed.command,
            parsed.username,
          )),
        });
      },
    });
  const read = <T>(
    request: Request,
    name: string,
    operation: (principal: AuthorizationPrincipal) => Promise<T>,
    headers: Readonly<Record<string, string>> = {},
  ) =>
    runMessagingHandler(dependencies.boundary, request, {
      name: `friends.${name}`,
      readOnly: true,
      readInput: async () => null,
      operation: (_input, principal) => operation(principal),
      headers: { 'cache-control': 'no-store', ...headers },
    });
  return {
    request: (request: Request) =>
      write(request, 'request', (input) => ({
        command: 'request',
        username: parseValidated(friendCommandSchemas.request, input).username,
      })),
    respond: (request: Request) =>
      write(request, 'respond', (input) => {
        const parsed = parseValidated(friendCommandSchemas.respond, input);
        return { command: parsed.decision, username: parsed.username };
      }),
    remove: (request: Request) =>
      write(request, 'remove', (input) => ({
        command: 'remove',
        username: parseValidated(friendCommandSchemas.remove, input).username,
      })),
    list: (request: Request) =>
      read(request, 'list', async (principal) =>
        friendListSchema.parse({
          version: 1,
          ...(await dependencies.list(principal)),
        }),
      ),
    counts: (request: Request) =>
      read(
        request,
        'counts',
        async (principal) =>
          onlineCountsSchema.parse({
            version: 1,
            ...(await dependencies.counts(principal)),
          }),
        dependencies.websocketEndpoint
          ? { 'x-realtime-socket-url': dependencies.websocketEndpoint }
          : {},
      ),
  };
}
