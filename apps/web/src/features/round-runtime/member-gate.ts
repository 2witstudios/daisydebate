import { roundRefusalSchema } from '@daisy/protocol';
import type { RateRule } from '../../server/rate-limit';
import { refusalResponse } from '../../server/http';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
  type MemberCaller,
} from '../../server/member-boundary';
export type RoundCaller = MemberCaller;
/** `view` is the Round itself, with its own budget beside the other member reads. */
type RoundOperation = 'read' | 'view' | 'command';
export type RoundMemberRouteDependencies = BudgetedMemberBoundary & {
  readonly limits: { readonly read: RateRule; readonly command: RateRule };
};
/** The member boundary for the Round's routes, answering its own refusals. */
export function createRoundMemberGate(d: RoundMemberRouteDependencies) {
  return (
    request: Request,
    operation: RoundOperation,
    action: (caller: RoundCaller) => Promise<Response>,
  ) =>
    runMemberRoute(
      d,
      request,
      {
        name: `round.${operation}`,
        readOnly: operation !== 'command',
        bucket: `round-member:${operation}`,
        rule: operation === 'command' ? d.limits.command : d.limits.read,
      },
      async (caller, { requestId }) => {
        try {
          return await action(caller);
        } catch (error) {
          const response = refusalResponse(
            error,
            requestId,
            roundRefusalSchema.options,
          );
          if (!response) throw error;
          return response;
        }
      },
    );
}
