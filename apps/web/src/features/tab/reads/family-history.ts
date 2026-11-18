import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { TabStore } from '@daisy/db/tab';
import { idSchema } from '@daisy/protocol';
import {
  familyHistoryViewSchema,
  type FamilyHistoryView,
} from '@daisy/protocol/lobby/guardian-read';
import type { TabPrincipal } from '../tab-principal';
type Dependencies = {
  readonly store: Pick<TabStore, 'familyHistory'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly minorsReleased: (userId: string) => Promise<boolean>;
};
/** Private subject history; the relationship is real and the actor never stands in for its protected subject. */
export const readFamilyHistory =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    input: { readonly guardianLinkId: string; readonly subjectUserId: string },
  ): Promise<FamilyHistoryView | null> => {
    if (
      !(await dependencies.minorsReleased(principal.userId)) ||
      !idSchema.safeParse(input.guardianLinkId).success ||
      !idSchema.safeParse(input.subjectUserId).success
    )
      return null;
    return dependencies.store.familyHistory(
      { ...input, viewerUserId: principal.userId },
      async (facts) => {
        if (!facts) return null;
        const decision = dependencies.authorize({
          principal,
          capability: 'guardian.link.read',
          resource: {
            kind: 'guardian_link',
            guardianActorId: facts.guardianActorId,
            wardActorId: facts.wardActorId,
            via: facts.authorization.organization,
          },
          context: {
            account: facts.authorization.account,
            grants: facts.authorization.grants,
            now: dependencies.now(),
          },
        });
        if (!decision.allow) return null;
        return familyHistoryViewSchema.parse({
          subjectUserId: facts.subjectUserId,
          entries: facts.entries.map((entry) => ({
            ...entry,
            appliedAt: entry.appliedAt.toISOString(),
          })),
        });
      },
    );
  };
