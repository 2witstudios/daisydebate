import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import {
  challengeCommandSchemas,
  challengeListSchema,
  challengeResultSchema,
  type RatingLadder,
  type ChallengeList,
  type CompetitionType,
  type ChallengeResult,
} from '@daisy/protocol';
import { parseValidated, readJson } from '../../server/http';
import {
  runMemberHandler,
  type MemberBoundary,
} from '../../server/member-handler';

const MAX_BODY_BYTES = 1024;
type Answer = Promise<Omit<ChallengeResult, 'version'>>;

/** The challenge routes (ADR 0103): same-origin, member-only, bounded bodies. */
export function createChallengeHandlers(dependencies: {
  readonly boundary: MemberBoundary;
  readonly websocketEndpoint: string | null;
  readonly list: (
    principal: AuthorizationPrincipal,
  ) => Promise<Omit<ChallengeList, 'version'> & { readonly actorId: string }>;
  readonly send: (
    principal: AuthorizationPrincipal,
    input: {
      readonly commandId: string;
      readonly username: string;
      readonly mode: CompetitionType;
      readonly format: RatingLadder;
    },
  ) => Answer;
  readonly accept: (
    principal: AuthorizationPrincipal,
    input: { readonly challengeId: string; readonly roomId: string },
  ) => Answer;
  readonly end: (
    principal: AuthorizationPrincipal,
    command: 'decline' | 'cancel',
    challengeId: string,
  ) => Answer;
}) {
  const write = (
    request: Request,
    name: string,
    run: (input: unknown, principal: AuthorizationPrincipal) => Answer,
  ) =>
    runMemberHandler(dependencies.boundary, request, {
      name: `challenges.${name}`,
      readOnly: false,
      readInput: () => readJson(request, MAX_BODY_BYTES),
      operation: async (input, principal) =>
        challengeResultSchema.parse({
          version: 1,
          ...(await run(input, principal)),
        }),
    });
  return {
    list: (request: Request) =>
      runMemberHandler(dependencies.boundary, request, {
        name: 'challenges.list',
        readOnly: true,
        readInput: async () => null,
        operation: async (_input, principal) => {
          const { actorId, ...list } = await dependencies.list(principal);
          return {
            actorId,
            ...challengeListSchema.parse({ version: 1, ...list }),
          };
        },
        headers: {
          'cache-control': 'no-store',
          ...(dependencies.websocketEndpoint
            ? { 'x-realtime-socket-url': dependencies.websocketEndpoint }
            : {}),
        },
      }),
    send: (request: Request) =>
      write(request, 'send', (input, principal) => {
        const { commandId, username, mode, format } = parseValidated(
          challengeCommandSchemas.send,
          input,
        );
        return dependencies.send(principal, {
          commandId,
          username,
          mode,
          format,
        });
      }),
    accept: (request: Request) =>
      write(request, 'accept', (input, principal) => {
        const { challengeId, roomId } = parseValidated(
          challengeCommandSchemas.accept,
          input,
        );
        return dependencies.accept(principal, { challengeId, roomId });
      }),
    decline: (request: Request) =>
      write(request, 'decline', (input, principal) =>
        dependencies.end(
          principal,
          'decline',
          parseValidated(challengeCommandSchemas.decline, input).challengeId,
        ),
      ),
    cancel: (request: Request) =>
      write(request, 'cancel', (input, principal) =>
        dependencies.end(
          principal,
          'cancel',
          parseValidated(challengeCommandSchemas.cancel, input).challengeId,
        ),
      ),
  };
}
