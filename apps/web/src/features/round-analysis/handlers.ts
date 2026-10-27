import { idSchema, type RoundAnalysisView } from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import {
  createRoundMemberGate,
  type RoundMemberRouteDependencies,
  type RoundCaller,
} from '../round-runtime/member-gate';

/** The caller's own round analysis: NOT_FOUND unless they debated the completed Round. */
export function createRoundAnalysisHandlers(
  d: RoundMemberRouteDependencies & {
    readonly read: (
      caller: RoundCaller,
      roundId: string,
    ) => Promise<RoundAnalysisView>;
  },
) {
  const run = createRoundMemberGate(d);
  return {
    getRoundAnalysis: (request: Request, roundId: string) =>
      run(request, 'read', async (caller) =>
        Response.json(await d.read(caller, parseValidated(idSchema, roundId))),
      ),
  };
}
