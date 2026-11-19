import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import {
  organizationPeopleViewSchema,
  type OrganizationPeopleView,
} from '@daisy/protocol/lobby/organization-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';

/** The organization a host page names by its address. */
const organizationPeopleQuerySchema = z.strictObject({
  handle: z.string().trim().min(1).max(64),
});

/** Where the people read is served: `GET` with the organization's handle. */
export const organizationPeoplePath = (handle: string): string =>
  `/api/tab/organization-people?${new URLSearchParams({ handle })}`;

export type OrganizationPeopleRouteDependencies = {
  readonly boundary: MemberBoundary;
  /** Whether Daisy Tab is released to this account. */
  readonly released: (userId: string) => Promise<boolean>;
  readonly organizationIdOfHandle: (handle: string) => Promise<string | null>;
  readonly read: (
    principal: TabPrincipal,
    organizationId: string,
  ) => Promise<OrganizationPeopleView | null>;
};

const asTabPrincipal = (principal: AuthorizationPrincipal): TabPrincipal => {
  if (principal.kind !== 'user') throw createAppError('NOT_FOUND');
  return principal;
};

/**
 * `OrganizationPeopleView` over HTTP, the read a host's people page and a
 * script call alike. A closed release, an unknown handle and a viewer the
 * evaluator does not let read the people all answer not found, so the
 * answer never tells an organization's existence to someone who may not
 * see it.
 */
export const createOrganizationPeopleRoute =
  (dependencies: OrganizationPeopleRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.organization.people',
      readOnly: true,
      readInput: async () =>
        parseValidated(
          organizationPeopleQuerySchema,
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      operation: async (input, authorizationPrincipal) => {
        const { handle } = input as z.infer<
          typeof organizationPeopleQuerySchema
        >;
        const principal = asTabPrincipal(authorizationPrincipal);
        if (!(await dependencies.released(principal.userId)))
          throw createAppError('NOT_FOUND');
        const organizationId =
          await dependencies.organizationIdOfHandle(handle);
        const view =
          organizationId === null
            ? null
            : await dependencies.read(principal, organizationId);
        if (view === null) throw createAppError('NOT_FOUND');
        return organizationPeopleViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
