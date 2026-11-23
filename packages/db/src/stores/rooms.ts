import { createCasualJudgeAdmission } from '../casual-judge-admission';
import { roomCommandOperations } from '../room-command-operations';
import { roundBotAdmissionEntrypoints } from '../round-bot-admission-entrypoints';
import type { RoundBotAdmissionOptions } from './round-bot-admission';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/**
 * Rooms: their commands on the competitive lane, Room preparation through
 * its own half-lane runner, bot and casual AI judge admission over the
 * caller's allowance.
 */
export const createRoomStore = (
  resources: DatabaseResources,
  { nextId, botAdmission, aiAllowance }: RoundBotAdmissionOptions,
) => {
  const { lane, bounded, roomCommands, eventSink } = resourcesOf(resources);
  const { admission } = roundBotAdmissionEntrypoints({
    run: bounded('competitive'),
    nextId,
    botAdmission,
    aiAllowance,
  });
  return namedLaneOperations(
    roomCommandOperations({
      database: lane('competitive').database,
      botAdmission: admission,
      judgeAdmission: aiAllowance
        ? createCasualJudgeAdmission({ policy: aiAllowance, nextId })
        : undefined,
      eventSink,
      commandTransaction: roomCommands(),
    }),
  );
};
export type RoomStore = ReturnType<typeof createRoomStore>;
