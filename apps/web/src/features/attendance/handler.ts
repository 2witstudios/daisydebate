import {
  attendanceRefusalSchema,
  idSchema,
  type AttendanceEnvelope,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { parseValidated, refusalResponse } from '../../server/http';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
} from '../../server/member-boundary';
import { readAttendanceCommand } from './body';
import { nativeAttendanceResponse } from './native-response';
type HandlerDeps = BudgetedMemberBoundary & {
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
    const roundId = () => parseValidated(idSchema, rawRoundId);
    const response = await runMemberRoute(
      deps,
      request,
      {
        name: 'attendance.check-in',
        readOnly: false,
        bucket: 'attendance',
        rule: attendanceRate,
        beforeBudget: roundId,
      },
      async (caller, { requestId }) => {
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
    );
    return request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded')
      ? nativeAttendanceResponse(response, rawRoundId)
      : response;
  };
}
