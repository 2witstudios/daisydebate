import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { roundRefusalSchema } from '@daisy/protocol';
import type { RateRule } from '../../server/rate-limit';
import {
  refusalResponse,
  handleOperation,
  requireSameOrigin,
  requireSameOriginRead,
} from '../../server/http';
import {
  requireMember,
  type MemberCaller,
  type MemberGateDependencies,
} from '../../server/member-gate';
export type RoundCaller = MemberCaller;
/** `view` is the Round itself, with its own budget beside the other member reads. */
type RoundOperation = 'read' | 'view' | 'command';
export type RoundMemberRouteDependencies = MemberGateDependencies & {
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from these gates' raw errors goes, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly limits: { readonly read: RateRule; readonly command: RateRule };
  readonly active: () => boolean;
};
/** Origin and the member gate for the Round's routes, answering its own refusals. */
export function createRoundMemberGate(d: RoundMemberRouteDependencies) {
  return (
    request: Request,
    operation: RoundOperation,
    action: (caller: RoundCaller) => Promise<Response>,
  ) =>
    handleOperation(
      d.logger,
      request,
      `round.${operation}`,
      async (requestId) => {
        if (!d.active()) throw createAppError('NOT_FOUND');
        if (operation === 'command') requireSameOrigin(request, d.origin());
        else requireSameOriginRead(request, d.origin());
        const caller = await requireMember(d, request, {
          bucket: `round-member:${operation}`,
          rule: operation === 'command' ? d.limits.command : d.limits.read,
        });
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
      d.reporter,
    );
}
