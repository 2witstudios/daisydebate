import { createId } from '@paralleldrive/cuid2';
import type { RoomView } from '@daisy/protocol';
import type { withRoomRuntime } from './room-runtime.test-support';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';

export async function launchRuntimeRound(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  room: RoomView,
) {
  const launched = await f.command(f.host, room, { type: 'start-round' });
  return {
    roundId: launched.view.roundRef!.id,
    operations: createRoundRuntimeOperations({
      store: f.store,
      nextSegmentId: createId,
    }),
    principal: { kind: 'human' as const, actorId: f.host.actorId },
  };
}

export async function startRuntimeRound(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  room: RoomView,
) {
  const launched = await launchRuntimeRound(f, room);
  const envelope = {
    version: 1 as const,
    commandId: createId(),
    expectedVersion: 1,
    command: { type: 'start' as const },
  };
  const receipt = await launched.operations.command(
    launched.principal,
    launched.roundId,
    envelope,
  );
  return { ...launched, envelope, receipt };
}
export { withRoomRuntime } from './room-runtime.test-support';
