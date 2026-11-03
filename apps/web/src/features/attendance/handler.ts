import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import {
  attendanceRefusalSchema,
  idSchema,
  type AttendanceEnvelope,
  type AttendanceReceipt,
} from '@daisy/protocol';
import {
  handleOperation,
  parseValidated,
  requireSameOrigin,
  refusalResponse,
} from '../../server/http';
import {
  requireMember,
  type MemberGateDependencies,
} from '../../server/member-gate';
import { readAttendanceCommand } from './body';
import { nativeAttendanceResponse } from './native-response';
type HandlerDeps = MemberGateDependencies & {
  readonly logger: Logger;
  /** ADR 0037: where this handler's 5xx raw errors go, scrubbed. */
  readonly reporter: ErrorReporter;
  readonly origin: () => string;
  readonly active: () => boolean;
  readonly checkIn: (
    principal: { readonly kind: 'human'; readonly actorId: string },
    roundId: string,
    envelope: AttendanceEnvelope,
  ) => Promise<AttendanceReceipt>;
};
const attendanceRate = { max: 120, windowSeconds: 60 } as const;
/** Normal member/session/origin/rate boundaries also govern the synthetic public-path probe. */
export function createAttendanceHandler(deps: HandlerDeps) {
  return async (request: Request, rawRoundId: string) => {
    const response = await handleOperation(
      deps.logger,
      request,
      'attendance.check-in',
      async (requestId) => {
        if (!deps.active()) throw createAppError('NOT_FOUND');
        requireSameOrigin(request, deps.origin());
        const roundId = () => parseValidated(idSchema, rawRoundId);
        const caller = await requireMember(deps, request, {
          bucket: 'attendance',
          rule: attendanceRate,
          beforeBudget: roundId,
        });
        const { envelope } = await readAttendanceCommand(request);
        try {
          const receipt = await deps.checkIn(
            { kind: 'human', actorId: caller.actorId },
            roundId(),
            envelope,
          );
          return Response.json(receipt);
        } catch (error) {
          const refused = refusalResponse(
            error,
            requestId,
            attendanceRefusalSchema.options,
          );
          if (refused) return refused;
          throw error;
        }
      },
      deps.reporter,
    );
    return request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded')
      ? nativeAttendanceResponse(response, rawRoundId)
      : response;
  };
}
