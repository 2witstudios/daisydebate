import { idSchema } from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import { createRoundMemberGate } from '../round-runtime/member-gate';
import type { App } from '../../server/app';
import { createAttendanceHandler } from './handler';
import { createAttendanceFeature } from './operations';

type MemberGates = Pick<
  Parameters<typeof createAttendanceHandler>[0],
  'logger' | 'identify' | 'origin' | 'getActorByUserId' | 'limiter'
>;
export function composeAttendanceRoutes(app: App, gates: MemberGates) {
  const operations = createAttendanceFeature({
    checkIns: app.database,
    evaluate: app.database.evaluateRoundAttendance,
    nextId: () => app.ids.next(),
    instanceId: app.ids.next(),
  });
  const read = createRoundMemberGate(composeRoundMemberDependencies(app));
  return {
    readNativeState: (request: Request, roundId: string) =>
      read(request, 'read', async (caller) =>
        Response.json(
          await operations.nativeState(
            { kind: 'human', actorId: caller.actorId },
            parseValidated(idSchema, roundId),
          ),
        ),
      ),
    checkIn: createAttendanceHandler({
      ...gates,
      active: () => Boolean(app.roomPolicy),
      checkIn: operations.checkIn,
    }),
  };
}
