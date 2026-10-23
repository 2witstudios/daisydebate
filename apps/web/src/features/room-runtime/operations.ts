import { createAppError } from '@daisy/errors';
import { canOfferFreshRoom } from './fresh-room';
import { roomBotAdmission } from './bot-admission';
import { authorize } from '@daisy/auth/authorization';
import { roomCommandOperation } from './command';
import { currentRoomConsent, type PreparedRoomConsent } from './consent';
import { can, digest } from './authority';
import { resolveRoomSelection } from './selection';
import { canReadRound } from '../round-runtime/reads';
import type { Database } from '@daisy/db';
import { hostIdentityHidden, projectRoom } from '@daisy/debate-engine';
import type { IdGenerator } from '@daisy/clock';
import type { createRedis } from '@daisy/redis';
import type {
  RoomListQuery,
  FormatDefinition,
  RoomAssemblyState,
  RoomCatalogChoice,
  RoomCastChoice,
  RoomCommandResponse,
  RoomCreate,
  RoomConfig,
} from '@daisy/protocol';

export type Caller = { readonly userId: string; readonly actorId: string };
export type Store = Pick<
  Database,
  | 'readRoundBotAdmissionStatus'
  | 'readLaunchedRound'
  | 'databaseNow'
  | 'listRoomCatalogSources'
  | 'listRoomBots'
  | 'getFormatRevision'
  | 'getCurrentPreset'
  | 'readRoomCreateReceipt'
  | 'createRoomCommand'
  | 'readRoomAssembly'
  | 'listRoomPage'
  | 'executeRoomCommand'
>;
type Redis = Pick<
  ReturnType<typeof createRedis>,
  'setRoomConsent' | 'readRoomConsent'
>;
/** Suggested initial config comes exclusively from the pinned format's declared legal choices. */
const initialConfig = (definition: FormatDefinition): RoomConfig => ({
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: false },
  speechTiming: {
    countdownMs: definition.configurable.timing.countdownMs.min,
    segmentDurationOverrides: {},
  },
  crossExamination: {
    crossExMode: definition.configurable.interaction.crossExModes[0]!,
  },
  interruptions: definition.configurable.interaction.interruptions
    ? {
        mode: definition.configurable.interaction.interruptions.modes[0]!,
        minRemainingMs:
          definition.configurable.interaction.interruptions.minRemainingMs.min,
      }
    : null,
  yielding: definition.configurable.interaction.yield
    ? {
        allowed: definition.configurable.interaction.yield.enabledChoices[0]!,
        returnsTime:
          definition.configurable.interaction.yield.returnsTimeChoices[0]!,
      }
    : null,
});

export function createRoomRuntimeOperations({
  store,
  redis,
  ids,
  maxOpenRooms,
  consentTtlMs,
  botsAvailable,
}: {
  readonly store: Store;
  readonly redis: Redis;
  readonly ids: IdGenerator;
  readonly maxOpenRooms: () => number;
  readonly consentTtlMs: () => number;
  readonly botsAvailable: () => boolean;
}) {
  const eligible = (state: RoomAssemblyState): RoomAssemblyState => ({
    ...state,
    participants: state.participants.map((p) => ({
      ...p,
      eligible: p.eligible && (p.kind === 'human' || botsAvailable()),
    })),
  });
  const consentOf = async (
    state: RoomAssemblyState,
    beforeRead: string,
  ): Promise<PreparedRoomConsent> => {
    try {
      const leases = await redis.readRoomConsent(
        state.id,
        state.version,
        state.participants
          .filter((p) => p.kind === 'human')
          .map((p) => ({
            actorId: p.actorId,
            commandId: p.consentCommandId,
          })),
      );
      return {
        available: true,
        readyActorIds: leases.map((lease) => lease.actorId),
        validUntil: leases.length
          ? new Date(
              Date.parse(beforeRead) +
                Math.min(...leases.map((lease) => lease.ttlMs)),
            ).toISOString()
          : null,
      };
    } catch {
      return { available: false, readyActorIds: [], validUntil: null };
    }
  };
  const view = async (caller: Caller, roomId: string) => {
    const state = eligible(
      await store.readRoomAssembly(roomId, caller, (state, account) =>
        can(caller, 'room.read', account, state),
      ),
    );
    const consent = await consentOf(state, await store.databaseNow());
    const now = await store.databaseNow();
    return {
      ...projectRoom(
        state,
        caller.actorId,
        currentRoomConsent(consent, now),
        now,
      ),
      botAdmission: await roomBotAdmission(state, caller.actorId, (actorId) =>
        store.readRoundBotAdmissionStatus(actorId),
      ),
    };
  };
  const catalog = async (
    caller: Caller,
  ): Promise<readonly RoomCatalogChoice[]> =>
    (
      await store.listRoomCatalogSources(caller, (account) =>
        can(caller, 'room.list', account),
      )
    ).map((source) => ({
      formatId: source.id,
      formatVersion: source.version,
      label: source.name,
      definition: source.definition,
      defaultConfig:
        source.presets.find((p) => p.length === 'full')?.config ??
        initialConfig(source.definition),
      presets: source.presets.map((p) => ({
        version: p.version,
        length: p.length as 'full' | 'quick',
        config: p.config,
      })),
    }));
  const create = async (
    caller: Caller,
    body: RoomCreate,
  ): Promise<RoomCommandResponse> => {
    const previous = await store.readRoomCreateReceipt({
      caller,
      commandId: body.commandId,
      payloadDigest: digest(body),
      authorize: (account) => can(caller, 'room.create', account),
    });
    if (previous)
      return { receipt: previous, view: await view(caller, previous.roomId) };
    const {
      selection,
      definition,
      config,
      formatId,
      formatVersion,
      presetVersion,
      competitionType,
      resolved,
    } = await resolveRoomSelection(
      body,
      body.selection.kind === 'custom' ? [] : await catalog(caller),
      store,
      ids,
    );
    const receipt = await store.createRoomCommand({
      caller,
      authorize: (account) => can(caller, 'room.create', account),
      maxOpenRooms: maxOpenRooms(),
      commandId: body.commandId,
      payloadDigest: digest(body),
      definition: selection.kind === 'custom' ? definition : null,
      room: {
        id: ids.next(),
        hostActorId: caller.actorId,
        title: body.title,
        topic: body.topic,
        visibility: body.visibility,
        formatId,
        formatVersion,
        presetVersion,
        competitionType,
        length: selection.length,
        config,
        executionPlan: resolved.roomPlan,
        rules: resolved.rules,
      },
    });
    return { receipt, view: await view(caller, receipt.roomId) };
  };
  return {
    view,
    roundView: (caller: Caller, roundId: string) =>
      store.readLaunchedRound(roundId, caller, (view, account) =>
        canReadRound(caller, view, account),
      ),
    catalog,
    async castChoices(caller: Caller): Promise<readonly RoomCastChoice[]> {
      return (
        await store.listRoomBots(caller, (account) =>
          can(caller, 'room.list', account),
        )
      )
        .filter((p) => p.kind === 'bot')
        .map((p) => ({
          actorId: p.actorId,
          kind: 'bot',
          label: p.label,
          eligible: p.eligible && botsAvailable(),
        }));
    },
    async list(caller: Caller, query: RoomListQuery) {
      return store.listRoomPage(
        caller,
        query,
        (fact, account) =>
          can(caller, 'room.read', account, fact) &&
          (!fact.round ||
            authorize({
              principal: { kind: 'user', ...caller },
              capability: 'round.read',
              context: { account },
              resource: fact.round,
            }).allow),
        (account) => can(caller, 'room.list', account),
        (fact) => hostIdentityHidden(fact, caller.actorId),
      );
    },
    create,
    async rematch(caller: Caller, sourceRoomId: string, body: RoomCreate) {
      const source = await store.readRoomAssembly(
        sourceRoomId,
        caller,
        (state, account) => can(caller, 'room.read', account, state),
      );
      if (source.hostActorId !== caller.actorId)
        throw createAppError('AUTHORIZATION');
      if (!canOfferFreshRoom(source, caller.actorId))
        throw createAppError('CONFLICT');
      return create(caller, body);
    },
    command: roomCommandOperation({
      store,
      redis,
      ids,
      botsAvailable,
      consentTtlMs,
      eligible,
      consentOf,
      view,
    }),
  };
}
export type RoomRuntimeOperations = ReturnType<
  typeof createRoomRuntimeOperations
>;
