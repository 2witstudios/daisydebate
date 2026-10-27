import type { Identity } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import type { Logger } from '@daisy/logger';
import {
  idSchema,
  type AttendanceEnvelope,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import {
  handleOperation,
  parseValidated,
  requireSameOrigin,
  requireSignedIn,
  refusalResponse,
} from '../../server/http';
import { readAttendanceCommand } from './body';
import { nativeAttendanceResponse } from './native-response';
type HandlerDeps = {
  readonly logger: Logger;
  readonly origin: () => string;
  readonly active: () => boolean;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly getActorByUserId: (
    userId: string,
  ) => Promise<{ readonly id: string } | null>;
  readonly limiter: () => AuthRateLimiter;
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
        const member = requireSignedIn(await deps.identify(request));
        if (member.state !== 'member') throw createAppError('AUTHORIZATION');
        const roundId = parseValidated(idSchema, rawRoundId);
        await consumeOrThrow(
          deps.limiter(),
          `attendance:${member.principal.userId}`,
          attendanceRate,
        );
        const actor = await deps.getActorByUserId(member.principal.userId);
        if (actor?.id !== member.principal.actorId)
          throw createAppError('AUTHORIZATION');
        const { envelope } = await readAttendanceCommand(request);
        try {
          const receipt = await deps.checkIn(
            { kind: 'human', actorId: actor.id },
            roundId,
            envelope,
          );
          return Response.json(receipt);
        } catch (error) {
          const refused = refusalResponse(error, requestId, [
            'attendance-terminal',
            'attendance-finalized',
            'attendance-segment',
            'attendance-window-closed',
            'attendance-too-early',
            'command-conflict',
          ]);
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
