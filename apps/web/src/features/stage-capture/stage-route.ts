import { createRoundRuntime } from '@daisy/debate-engine';
import { isRoundRunning } from '@daisy/protocol';
import {
  observerAccess,
  stageCredentialValid,
  stageSnapshot,
} from './stage-access';

type StageStore = {
  readonly readStage: (id: string) => Promise<{
    readonly capture: {
      readonly stageCredentialHash: string | null;
      readonly observerRevokedAt: Date | null;
      readonly completedAt: Date | null;
      readonly stoppedAt: Date | null;
      /** No control plane has reached this capture lately: nothing can revoke it. */
      readonly heartbeatStale: boolean;
    };
    readonly round: Parameters<typeof createRoundRuntime>[0]['round'] &
      Pick<
        Parameters<typeof createRoundRuntime>[0],
        'rules' | 'participants' | 'checkpoint' | 'segments'
      >;
    readonly roomName: string | null;
    readonly seats: Parameters<typeof stageSnapshot>[0]['seats'];
  } | null>;
};

/** Told to the stage page alone: end this Egress now. */
const STAGE_ENDS_STATUS = 410;

const refuse = () =>
  Response.json(null, {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });

/**
 * What the stage page needs and nothing more. Without the credential it answers
 * as if the capture did not exist. The token follows the current revocation.
 */
export const createStageRoute =
  (deps: {
    readonly store: StageStore;
    readonly observerToken: (
      room: string,
      access: { readonly canSubscribe: boolean },
    ) => Promise<string>;
    /** A healthy node for this room, asked afresh on each poll. */
    readonly livekitUrlFor: (room: string) => string;
    readonly now: () => number;
    readonly nextId: () => string;
  }) =>
  async (request: Request, id: string): Promise<Response> => {
    const read = await deps.store.readStage(id);
    if (
      !read ||
      read.capture.completedAt !== null ||
      read.capture.stoppedAt !== null ||
      !stageCredentialValid(
        request.headers.get('x-stage-credential'),
        read.capture.stageCredentialHash,
      )
    )
      return refuse();
    // Only someone holding the credential learns this: the stage ends its own Egress.
    if (read.capture.heartbeatStale)
      return Response.json(null, {
        status: STAGE_ENDS_STATUS,
        headers: { 'cache-control': 'no-store' },
      });
    const nowMs = deps.now();
    const position = createRoundRuntime({
      ...read.round,
      round: read.round,
      nextSegmentId: deps.nextId,
    }).position(new Date(nowMs).toISOString());
    return Response.json(
      {
        ...stageSnapshot({ position, seats: read.seats }),
        nowMs,
        // A Round that is over has no stage: its session's room may by now be a
        // post-round call's, which nothing ever observes (ADR 0127).
        room:
          read.roomName && isRoundRunning(read.round.status)
            ? {
                url: deps.livekitUrlFor(read.roomName),
                token: await deps.observerToken(
                  read.roomName,
                  observerAccess(read.capture),
                ),
              }
            : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  };
