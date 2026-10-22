import { idSchema } from '@daisy/protocol';
import type { Database } from '@daisy/db';
import { parseValidated } from '../../server/http';
import {
  createRoundMemberGate,
  type RoundMemberRouteDependencies,
  type RoundCaller,
} from '../round-runtime/member-gate';
import type { createRoundBallotOperations } from './operations';
import { readRoundBallotBody } from './body';
export function createRoundBallotHandlers(
  d: RoundMemberRouteDependencies & {
    readonly maxBodyBytes: number;
    readonly operations: ReturnType<typeof createRoundBallotOperations>;
    readonly read: (
      caller: RoundCaller,
      roundId: string,
    ) => ReturnType<Database['readRoundBallot']>;
    readonly assignments: (
      caller: RoundCaller,
    ) => ReturnType<Database['listRoundJudgeAssignments']>;
  },
) {
  const run = createRoundMemberGate(d);
  return {
    getBallots: (request: Request, roundId: string) =>
      run(request, 'read', async (caller) =>
        Response.json(await d.read(caller, parseValidated(idSchema, roundId))),
      ),
    judgeAssignments: (request: Request) =>
      run(request, 'read', async (caller) =>
        Response.json(await d.assignments(caller)),
      ),
    submitBallot: (request: Request, roundId: string) =>
      run(request, 'command', async (caller) => {
        const id = parseValidated(idSchema, roundId);
        const { envelope, native } = await readRoundBallotBody(
          request,
          d.maxBodyBytes,
        );
        const receipt = await d.operations.submit(
          { kind: 'human', actorId: caller.actorId },
          id,
          envelope,
        );
        return native
          ? new Response(null, {
              status: 303,
              headers: { location: `/judge/ballot/${id}` },
            })
          : Response.json({ receipt });
      }),
  };
}
