import { createRoundRuntime } from '@daisy/debate-engine';
import {
  observerAccess,
  stageCredentialValid,
  stageSnapshot,
} from './stage-access';

type StageStore = {
  readonly readStage: (id: string) => Promise<{
    readonly broadcast: {
      readonly stageCredentialHash: string | null;
      readonly observerRevokedAt: Date | null;
      readonly completedAt: Date | null;
      readonly stoppedAt: Date | null;
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

const refuse = () =>
  Response.json(null, {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });

/**
 * What the stage page needs and nothing more. Without the credential it answers
 * as if the Broadcast did not exist. The token follows the current revocation.
 */
export const createStageRoute =
  (deps: {
    readonly store: StageStore;
    readonly observerToken: (
      room: string,
      access: { readonly canSubscribe: boolean },
    ) => Promise<string>;
    readonly livekitUrl: string;
    readonly now: () => number;
    readonly nextId: () => string;
  }) =>
  async (request: Request, id: string): Promise<Response> => {
    const read = await deps.store.readStage(id);
    if (
      !read ||
      read.broadcast.completedAt !== null ||
      read.broadcast.stoppedAt !== null ||
      !stageCredentialValid(
        request.headers.get('x-stage-credential'),
        read.broadcast.stageCredentialHash,
      )
    )
      return refuse();
    const position = createRoundRuntime({
      ...read.round,
      round: read.round,
      nextSegmentId: deps.nextId,
    }).position(new Date(deps.now()).toISOString());
    return Response.json(
      {
        ...stageSnapshot({ position, seats: read.seats }),
        nowMs: deps.now(),
        room: read.roomName
          ? {
              url: deps.livekitUrl,
              token: await deps.observerToken(
                read.roomName,
                observerAccess(read.broadcast),
              ),
            }
          : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  };
