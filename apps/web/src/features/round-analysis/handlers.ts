import { idSchema, type RoundAnalysisView } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { readBoundedBody } from '../../server/bounded-body';
import { analysisRequestNotice } from './request-notice';
import { parseValidated } from '../../server/http';
import {
  createRoundMemberGate,
  type RoundMemberRouteDependencies,
  type RoundCaller,
} from '../round-runtime/member-gate';

/** The caller's own round analysis: NOT_FOUND unless they debated the completed Round. */
export function createRoundAnalysisHandlers(
  d: RoundMemberRouteDependencies & {
    readonly request: (
      caller: RoundCaller,
      roundId: string,
    ) => Promise<unknown>;
    readonly read: (
      caller: RoundCaller,
      roundId: string,
    ) => Promise<RoundAnalysisView>;
  },
) {
  const run = createRoundMemberGate(d);
  return {
    requestRoundAnalysis: async (request: Request, roundId: string) => {
      const response = await run(request, 'command', async (caller) => {
        const id = parseValidated(idSchema, roundId);
        const body = await readBoundedBody(request, 1024);
        if (body === null || body.length !== 0)
          throw createAppError('VALIDATION');
        await d.request(caller, id);
        return new Response(null, {
          status: 303,
          headers: {
            location: `/rounds/${id}#round-analysis`,
            'cache-control': 'no-store',
          },
        });
      });
      if (
        response.status < 400 ||
        !request.headers.get('accept')?.includes('text/html') ||
        !idSchema.safeParse(roundId).success
      )
        return response;
      return new Response(null, {
        status: 303,
        headers: {
          location: `/rounds/${roundId}?analysis=${analysisRequestNotice}#round-analysis`,
          'cache-control': 'no-store',
        },
      });
    },
    getRoundAnalysis: (request: Request, roundId: string) =>
      run(request, 'read', async (caller) =>
        Response.json(await d.read(caller, parseValidated(idSchema, roundId))),
      ),
  };
}
