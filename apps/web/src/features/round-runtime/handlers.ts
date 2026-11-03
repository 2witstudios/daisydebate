import type { Clock } from '@daisy/clock';
import {
  idSchema,
  roundCommandEnvelopeSchema,
  type RoundCommandResponse,
  type RoundView,
} from '@daisy/protocol';
import { parseValidated, readJson } from '../../server/http';
import {
  createRoundMemberGate,
  type RoundMemberRouteDependencies,
  type RoundCaller as Caller,
} from './member-gate';
import type { createRoundRuntimeOperations } from './operations';
import { serverClockHeaders } from './server-clock-header';
type Dependencies = RoundMemberRouteDependencies & {
  readonly maxBodyBytes: number;
  /** The authorized server instant a Round read stamps for client calibration. */
  readonly clock: Clock;
  /** Named on a Round read, where its doorbell rings. */
  readonly websocketEndpoint?: string | null;
  readonly operations: Pick<
    ReturnType<typeof createRoundRuntimeOperations>,
    'command'
  >;
  readonly view: (caller: Caller, roundId: string) => Promise<RoundView>;
  readonly transcript: (caller: Caller, roundId: string) => Promise<unknown>;
};
/** Shared HTTP gates for the JSON command envelope; native forms reach it through the server action, and bots call the same operation server-side. */
export function createRoundHandlers(d: Dependencies) {
  const run = createRoundMemberGate(d);
  const doorbell = d.websocketEndpoint
    ? { 'x-realtime-socket-url': d.websocketEndpoint }
    : {};
  return {
    read: (request: Request, roundId: string) =>
      run(request, 'view', async (caller) =>
        Response.json(await d.view(caller, parseValidated(idSchema, roundId)), {
          headers: { ...doorbell, ...serverClockHeaders(d.clock) },
        }),
      ),
    transcript: (request: Request, roundId: string) =>
      run(request, 'read', async (caller) =>
        Response.json(
          await d.transcript(caller, parseValidated(idSchema, roundId)),
        ),
      ),
    commands: (request: Request, roundId: string) =>
      run(request, 'command', async (caller) => {
        const id = parseValidated(idSchema, roundId);
        const envelope = parseValidated(
          roundCommandEnvelopeSchema,
          await readJson(request, d.maxBodyBytes),
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
        return Response.json(response);
      }),
  };
}
