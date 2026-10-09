import type { Store, Caller } from './operations';
import { executeRoomCommand } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type { IdGenerator } from '@daisy/clock';
import type { createRedis } from '@daisy/redis';
import type {
  RoomAssemblyState,
  RoomConsent,
  RoomCommand,
  RoomCommandResponse,
} from '@daisy/protocol';
import { can, capabilityOf, digest } from './authority';
export function roomCommandOperation({
  store,
  redis,
  ids,
  botsAvailable,
  consentTtlMs,
  eligible,
  consentOf,
  view,
}: {
  store: Store;
  redis: Pick<ReturnType<typeof createRedis>, 'setRoomConsent'>;
  ids: IdGenerator;
  botsAvailable: () => boolean;
  consentTtlMs: () => number;
  eligible: (state: RoomAssemblyState) => RoomAssemblyState;
  consentOf: (state: RoomAssemblyState) => Promise<RoomConsent>;
  view: (
    caller: Caller,
    roomId: string,
  ) => Promise<RoomCommandResponse['view']>;
}) {
  return async function command(
    caller: Caller,
    roomId: string,
    command: RoomCommand,
  ): Promise<RoomCommandResponse> {
    const receipt = await store.executeRoomCommand({
      caller,
      roomId,
      actorId: caller.actorId,
      commandId: command.commandId,
      payloadDigest: digest(command),
      type: command.type,
      targetActorId:
        command.type === 'claim-seat'
          ? caller.actorId
          : command.type === 'assign-seat'
            ? command.actorId
            : null,
      roundId: ids.next(),
      authorizeRead: (state, account) =>
        can(caller, 'room.read', account, state),
      execute: async (raw, now, target, account) => {
        if (!can(caller, capabilityOf(command), account, raw))
          throw createAppError('AUTHORIZATION');
        const state = eligible(raw);
        const outcome = executeRoomCommand(
          state,
          caller.actorId,
          command,
          await consentOf(state),
          {
            now,
            participantId: ids.next(),
            formatId: ids.next(),
            target: target
              ? {
                  ...target,
                  id: '',
                  consentVersion: 0,
                  role:
                    command.type === 'claim-seat' ||
                    command.type === 'assign-seat'
                      ? command.role
                      : 'judge',
                  slot: 0,
                  eligible:
                    target.eligible &&
                    (target.kind === 'human' || botsAvailable()),
                }
              : null,
          },
        );
        if (outcome.ok && outcome.mutation.consent?.type === 'ready') {
          const consent = outcome.mutation.consent;
          await redis.setRoomConsent({
            roomId,
            version: state.version,
            actorId: consent.actorId,
            commandId: consent.commandId,
            ttlMs: consentTtlMs(),
          });
        }
        // Unready replaces the durable fence even during Redis loss; the old lease no longer matches.
        return outcome;
      },
    });
    return { receipt, view: await view(caller, roomId) };
  };
}
