import { createAppError } from '@daisy/errors';
import type { ZodType } from 'zod';
import type { OperationName } from '../ops/operation-names';
import {
  handleOperation,
  parseValidated,
  requireSameOriginRead,
} from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';

type ReadRoute<Query, View> = {
  readonly name: OperationName;
  readonly boundary: MemberBoundary;
  readonly query: ZodType<Query>;
} & (
  | {
      readonly access?: 'signed-in';
      readonly released: (userId: string) => Promise<boolean>;
      readonly validateBeforeRelease?: true;
      readonly view: ZodType<View>;
      readonly read: (
        principal: TabPrincipal,
        query: Query,
      ) => Promise<View | null>;
    }
  | {
      readonly access: 'public-posting';
      readonly released: (userId: string | null) => Promise<boolean>;
      readonly read: (
        principal: TabPrincipal | null,
        query: Query,
        request: Request,
      ) => Promise<unknown>;
    }
);

/** Bind a Tab read to the identity and release policy of its mounted route. */
export const bindTabRead =
  <Query, View>(route: ReadRoute<Query, View>) =>
  (request: Request) => {
    const readQuery = () =>
      parseValidated(
        route.query,
        Object.fromEntries(new URL(request.url).searchParams),
      );
    if (route.access === 'public-posting') {
      return handleOperation(
        route.boundary.logger,
        request,
        route.name,
        async () => {
          requireSameOriginRead(request, route.boundary.origin());
          const identity = await route.boundary.identify(request);
          if (identity.state === 'unavailable')
            throw createAppError('INFRASTRUCTURE');
          if (identity.state !== 'member' && identity.state !== 'anonymous')
            throw createAppError('NOT_FOUND');
          const principal =
            identity.state === 'member' ? identity.principal : null;
          if (!(await route.released(principal?.userId ?? null)))
            throw createAppError('NOT_FOUND');
          return Response.json(
            await route.read(principal, readQuery(), request),
          );
        },
        route.boundary.reporter,
      );
    }

    return runEvaluatedRoute(route.boundary, request, {
      name: route.name,
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_input, principal) => {
        const query = route.validateBeforeRelease
          ? { input: readQuery() }
          : null;
        if (
          principal.kind !== 'user' ||
          !(await route.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const view = await route.read(
          principal,
          query ? query.input : readQuery(),
        );
        if (view === null) throw createAppError('NOT_FOUND');
        return route.view.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
  };
