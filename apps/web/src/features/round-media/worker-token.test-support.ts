import { createAppError } from '@daisy/errors';
import { createRoundMediaOperations } from './operations';
import { createMediaWorkerTokenBroker } from './worker-token';
import { createMediaWorld, fixedId } from './media-world.test-support';

type Broker = Parameters<typeof createMediaWorkerTokenBroker>[0];
const workerId = fixedId('worker');
export const broker = (
  world: ReturnType<typeof createMediaWorld>,
  leased: () => boolean = () => true,
) => {
  const verified: string[] = [];
  const capture = {
    verifyMediaWorkerLease: async (scope: { workerId: string }) => {
      verified.push(scope.workerId);
      if (!leased()) throw createAppError('CONFLICT', 'Lease lost');
      return { serverNow: '2026-10-22T00:00:00.000Z' };
    },
  } as unknown as Broker['capture'];
  return {
    verified,
    tokens: createMediaWorkerTokenBroker({
      sessions: world.input.store,
      capture,
      media: world.input.media,
      workerUrl: world.input.workerUrl,
      nextId: world.input.nextId,
      deadline: world.input.deadline,
      hold: createRoundMediaOperations(world.input).holdForCapture,
    }),
  };
};
export const scope = (world: ReturnType<typeof createMediaWorld>) => ({
  roundId: world.roundId,
  sessionId: fixedId('session'),
  workerId,
  epoch: 1,
});
export const authenticated = (world: ReturnType<typeof createMediaWorld>) =>
  ({
    roundId: world.roundId,
    workerId,
    serviceId: `media-capture:${workerId}`,
  }) as Parameters<
    ReturnType<typeof createMediaWorkerTokenBroker>['captureToken']
  >[1];
