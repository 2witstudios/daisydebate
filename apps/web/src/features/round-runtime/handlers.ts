import { readRoundCommand } from './command-body';
import {
  idSchema,
  type RoundCommandResponse,
  type RoundView,
} from '@daisy/protocol';
import { parseValidated } from '../../server/http';
import {
  createRoundMemberGate,
  type RoundMemberRouteDependencies,
  type RoundCaller as Caller,
} from './member-gate';
import type { createRoundRuntimeOperations } from './operations';
type Dependencies = RoundMemberRouteDependencies & {
  readonly maxBodyBytes: number;
  readonly operations: Pick<
    ReturnType<typeof createRoundRuntimeOperations>,
    'command'
  >;
  readonly view: (caller: Caller, roundId: string) => Promise<RoundView>;
  readonly utterances: (
    caller: Caller,
    roundId: string,
    segmentId: string,
  ) => Promise<unknown>;
};
/** Shared HTTP gates for browser JSON and native POST callers; bots call the same operation server-side. */
export function createRoundHandlers(d: Dependencies) {
  const run = createRoundMemberGate(d);
  const read = (
    request: Request,
    roundId: string,
    select: (view: RoundView) => unknown,
  ) =>
    run(request, 'read', async (caller) =>
      Response.json(
        select(await d.view(caller, parseValidated(idSchema, roundId))),
      ),
    );
  return {
    participants: (request: Request, roundId: string) =>
      read(request, roundId, (view) => ({
        roundId: view.id,
        version: view.version,
        participants: view.participants,
      })),
    segments: (request: Request, roundId: string) =>
      read(request, roundId, (view) => ({
        roundId: view.id,
        version: view.version,
        segments: view.segments,
      })),
    utterances: (request: Request, roundId: string, segmentId: string) =>
      run(request, 'read', async (caller) =>
        Response.json(
          await d.utterances(
            caller,
            parseValidated(idSchema, roundId),
            parseValidated(idSchema, segmentId),
          ),
        ),
      ),
    commands: (request: Request, roundId: string) =>
      run(request, 'command', async (caller) => {
        const id = parseValidated(idSchema, roundId);
        const { envelope, native } = await readRoundCommand(
          request,
          d.maxBodyBytes,
        );
        const receipt = await d.operations.command(
          { kind: 'human', actorId: caller.actorId },
          id,
          envelope,
        );
        const response: RoundCommandResponse = {
          receipt,
          view: await d.view(caller, id),
        };
        return native
          ? new Response(null, {
              status: 303,
              headers: { location: `/rounds/${id}` },
            })
          : Response.json(response);
      }),
  };
}
