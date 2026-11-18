import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  familyHistoryViewSchema,
  type FamilyHistoryView,
} from '@daisy/protocol/lobby/guardian-read';
import { z } from 'zod';
import { parseValidated } from '../../server/http';
import {
  runEvaluatedRoute,
  type MemberBoundary,
} from '../../server/member-boundary';
import type { TabPrincipal } from './tab-principal';
const querySchema = z.strictObject({
  guardianLinkId: idSchema,
  subjectUserId: idSchema,
});
export type FamilyHistoryRouteDependencies = {
  readonly boundary: MemberBoundary;
  readonly released: (userId: string) => Promise<boolean>;
  readonly read: (
    principal: TabPrincipal,
    input: z.infer<typeof querySchema>,
  ) => Promise<FamilyHistoryView | null>;
};
/** A named protected subject and current relationship; closed release answers before parsing input. */
export const createFamilyHistoryRoute =
  (dependencies: FamilyHistoryRouteDependencies) => (request: Request) =>
    runEvaluatedRoute(dependencies.boundary, request, {
      name: 'tab.family.history',
      readOnly: true,
      readInput: async () => undefined,
      operation: async (_input, principal) => {
        if (
          principal.kind !== 'user' ||
          !(await dependencies.released(principal.userId))
        )
          throw createAppError('NOT_FOUND');
        const input = parseValidated(
          querySchema,
          Object.fromEntries(new URL(request.url).searchParams),
        );
        const view = await dependencies.read(principal, input);
        if (!view) throw createAppError('NOT_FOUND');
        return familyHistoryViewSchema.parse(view);
      },
      headers: { 'cache-control': 'no-store' },
    });
