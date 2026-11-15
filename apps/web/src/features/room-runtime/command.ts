import type { Store, Caller } from './operations';
import { aiServesSeat } from './ai-seat';
import type { AiSeatAvailability } from '../../server/round-worker-policy';
import { currentRoomConsent, type PreparedRoomConsent } from './consent';
import { castSeatsBotDebater, executeRoomCommand } from '@daisy/debate-engine';
import { createAppError, createRefusal } from '@daisy/errors';
import type { IdGenerator } from '@daisy/clock';
import type { createRedis } from '@daisy/redis';
import {
  judgeSeat,
  type RoomAssemblyState,
  type RoomCommand,
  type RoomCommandResponse,
} from '@daisy/protocol';
import { can, capabilityOf, digest } from './authority';
import { hostHoldsCasualCapture } from './capture-offer';
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
  aiSeats,
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
  aiSeats: () => AiSeatAvailability;
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
    // One id for the Round a Start round launches: the engine names it and the store inserts it.
    const roundId = ids.next();
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
      roundId,
      seatsBotDebater: castSeatsBotDebater,
      readyAgreements: (state) => {
        const notice = roomCaptureNotice(state);
        const contentWaiverVersion = requiredContentWaiver(state);
        return notice || contentWaiverVersion
          ? {
              contentWaiverVersion,
              notice: notice && {
                id: ids.next(),
                version: notice.version,
                words: notice.text,
              },
            }
          : null;
      },
      authorizeRead: (state, account, direction, now) =>
        can(caller, 'room.read', account, state, direction, now),
      authorizeCommand: (state, account, direction, now) =>
        (state.hostActorId !== null ||
          capabilityOf(command) !== 'room.manage' ||
          command.type === 'start-round') &&
        can(caller, capabilityOf(command), account, state, direction, now),
      prepare: async (raw, preparedAt, account, direction) => {
        if (
          !can(
            caller,
            capabilityOf(command),
            account,
            raw,
            direction,
            preparedAt,
          )
        )
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
              roundId: null,
              formatId: ids.next(),
              // Ready seats nobody; only seating and Launch read this.
              hostMaySeatCasualAiJudge: false,
              hostHoldsCasualCapture: false,
              target: null,
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
        // Only a Start round draws, so only it mints a draw id and entropy.
        const secrets =
          command.type === 'start-round' &&
          prepared.executionPlan.resolutionDraw.enabled
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
          maySeatCasualAiJudge,
          direction,
        ) => {
          if (!can(caller, capabilityOf(command), account, raw, direction, now))
            throw createAppError('AUTHORIZATION');
          const state = eligible(raw);
          const seat =
            command.type === 'claim-seat' || command.type === 'assign-seat'
              ? command.seat
              : judgeSeat();
          const outcome = executeRoomCommand(
            state,
            caller.actorId,
            command,
            currentRoomConsent(consent, now),
            {
              now,
              direction:
                direction && command.type === 'start-round'
                  ? {
                      roomId,
                      actorId: caller.actorId,
                      command: 'start-round',
                      captureAdmitted:
                        state.capture?.recordingPolicy === 'off' &&
                        state.capture.broadcast === null,
                    }
                  : null,
              participantId: ids.next(),
              roundId: command.type === 'start-round' ? roundId : null,
              formatId: ids.next(),
              hostMaySeatCasualAiJudge:
                state.hostActorId === caller.actorId && maySeatCasualAiJudge,
              hostHoldsCasualCapture:
                state.hostActorId === caller.actorId &&
                hostHoldsCasualCapture(grants, betaGrantsPremium, now),
              formatFacts,
              resolutionPublication,
              target: target
                ? {
                    ...target,
                    id: '',
                    consentVersion: 0,
                    seat,
                    eligible:
                      target.eligible &&
                      (target.kind === 'human' ||
                        aiServesSeat(aiSeats(), seat.kind)),
                  }
                : null,
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
            if (refusal) throw createRefusal('CONFLICT', refusal);
          }
          // Unready replaces the durable fence even during Redis loss; the old lease no longer matches.
          return outcome;
        };
      },
    });
    return { receipt, view: await view(caller, roomId) };
  };
}
