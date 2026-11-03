import type { Store, Caller } from './operations';
import { currentRoomConsent, type PreparedRoomConsent } from './consent';
import { castSeatsBotDebater, executeRoomCommand } from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type { IdGenerator } from '@daisy/clock';
import type { createRedis } from '@daisy/redis';
import type {
  RoomAssemblyState,
  RoomCommand,
  RoomCommandResponse,
} from '@daisy/protocol';
import { can, capabilityOf, digest } from './authority';
import { hostHoldsCasualAiJudge } from './ai-judge-seating';
import {
  captureNoticeRefusal,
  contentWaiverRefusal,
  requiredContentWaiver,
  roomCaptureNotice,
} from './ready-agreements';
export function roomCommandOperation({
  store,
  redis,
  ids,
  botsAvailable,
  betaGrantsPremium,
  consentTtlMs,
  eligible,
  consentOf,
  view,
  entropy,
}: {
  store: Store;
  redis: Pick<ReturnType<typeof createRedis>, 'setRoomConsent'>;
  ids: IdGenerator;
  botsAvailable: () => boolean;
  betaGrantsPremium: boolean;
  consentTtlMs: () => number;
  eligible: (state: RoomAssemblyState) => RoomAssemblyState;
  consentOf: (
    state: RoomAssemblyState,
    beforeRead: string,
  ) => Promise<PreparedRoomConsent>;
  view: (
    caller: Caller,
    roomId: string,
  ) => Promise<RoomCommandResponse['view']>;
  entropy: () => string;
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
      formatTuple:
        command.type === 'select-format'
          ? {
              formatId: command.formatId,
              formatVersion: command.formatVersion,
              presetVersion: command.presetVersion,
            }
          : null,
      roundId: ids.next(),
      seatsBotDebater: castSeatsBotDebater,
      readyAgreements: (state) => {
        const notice = roomCaptureNotice(state);
        const contentWaiverVersion = requiredContentWaiver(state);
        return notice || contentWaiverVersion
          ? {
              contentWaiverVersion,
              notice: notice && { id: ids.next(), version: notice.version },
            }
          : null;
      },
      authorizeRead: (state, account) =>
        can(caller, 'room.read', account, state),
      prepare: async (raw, preparedAt, account, preparedSeed) => {
        if (!can(caller, capabilityOf(command), account, raw))
          throw createAppError('AUTHORIZATION');
        const prepared = eligible(raw);
        const consent = await consentOf(prepared, preparedAt);
        if (command.type === 'ready') {
          const outcome = executeRoomCommand(
            prepared,
            caller.actorId,
            command,
            currentRoomConsent(consent, preparedAt),
            {
              now: preparedAt,
              participantId: ids.next(),
              formatId: ids.next(),
              // Ready seats nobody; only seating and Launch read this.
              hostHoldsCasualAiJudge: false,
              target: null,
              drawSeed: preparedSeed,
              drawStart: null,
            },
          );
          if (outcome.ok && outcome.mutation.consent?.type === 'ready')
            await redis.setRoomConsent({
              roomId,
              version: prepared.version,
              actorId: caller.actorId,
              commandId: command.commandId,
              ttlMs: consentTtlMs(),
            });
        }
        // Only a pre-round start draws, so only it mints a draw id and entropy.
        const secrets =
          command.type === 'start-pre-round'
            ? { drawId: ids.next(), seed: entropy(), salt: entropy() }
            : null;
        return (
          raw,
          now,
          target,
          account,
          draw,
          formatFacts,
          resolutionPublication,
          grants,
          contentWaiver,
        ) => {
          if (!can(caller, capabilityOf(command), account, raw))
            throw createAppError('AUTHORIZATION');
          const state = eligible(raw);
          const outcome = executeRoomCommand(
            state,
            caller.actorId,
            command,
            currentRoomConsent(consent, now),
            {
              now,
              participantId: ids.next(),
              formatId: ids.next(),
              // Only the host's own grants speak for the host.
              hostHoldsCasualAiJudge:
                state.hostActorId === caller.actorId &&
                hostHoldsCasualAiJudge(grants, betaGrantsPremium),
              formatFacts,
              resolutionPublication,
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
              drawSeed: draw.seed,
              drawStart: secrets
                ? {
                    ...secrets,
                    bank: draw.bank,
                    exclusions: draw.exclusions,
                  }
                : null,
            },
          );
          if (outcome.ok && command.type === 'ready') {
            const refusal =
              contentWaiverRefusal(contentWaiver) ??
              captureNoticeRefusal(state, command.noticeVersion);
            if (refusal) throw createAppError('CONFLICT', refusal);
          }
          // Unready replaces the durable fence even during Redis loss; the old lease no longer matches.
          return outcome;
        };
      },
    });
    return { receipt, view: await view(caller, roomId) };
  };
}
