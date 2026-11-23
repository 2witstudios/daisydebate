import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import type { OperationName } from '../../server/operation-names';
import { readJson } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../auth/member-boundary';
import { CommandDenied } from './commands/run-command';
import type { TabPrincipal } from './tab-principal';

type Common = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
};
export type TabCommandOperation = { readonly name: OperationName } & (
  | {
      readonly address: 'none';
      readonly execute: (
        principal: TabPrincipal,
        body: unknown,
      ) => Promise<LobbyCommandAnswer<string>>;
    }
  | {
      readonly address: 'lobby';
      readonly execute: (
        principal: TabPrincipal,
        lobbyId: string,
        body: unknown,
      ) => Promise<LobbyCommandAnswer<string>>;
    }
  | {
      readonly address: 'person';
      readonly execute: (
        principal: TabPrincipal,
        subjectUserId: string,
        body: unknown,
      ) => Promise<LobbyCommandAnswer<string>>;
    }
);
export type TabCommandRouteDependencies = Common & TabCommandOperation;
/**
 * The same operation scripts use, behind the real origin, session and
 * release boundary. The principal never comes from the body. A withdrawal
 * can reach its evaluator even when identity resolution marks it restricted.
 */
export const createTabCommandRoute =
  (dependencies: TabCommandRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: dependencies.name,
      readOnly: false,
      readInput: async () => null,
      operation: async (_input, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const body = await readJson(request, 65_536);
        try {
          if (dependencies.address === 'none')
            return await dependencies.execute(principal, body);
          const target = idSchema.safeParse(
            new URL(request.url).searchParams.get(
              dependencies.address === 'lobby' ? 'lobbyId' : 'subjectUserId',
            ),
          );
          if (!target.success) throw createAppError('VALIDATION');
          return await dependencies.execute(principal, target.data, body);
        } catch (error) {
          if (error instanceof CommandDenied) throw createAppError('NOT_FOUND');
          throw error;
        }
      },
      headers: { 'cache-control': 'no-store' },
    });
