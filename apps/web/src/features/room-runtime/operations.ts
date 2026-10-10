import { roomCommandOperation } from './command';
import { can, digest } from './authority';
import { resolveRoomSelection } from './selection';
import {
  authorize,
  type RoundAuthorizationFact,
} from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';
import { projectRoom } from '@daisy/debate-engine';
import type { IdGenerator } from '@daisy/clock';
import type { createRedis } from '@daisy/redis';
import type {
  FormatDefinition,
  RoomAssemblyState,
  RoomCatalogChoice,
  RoomCastChoice,
  RoomCommandResponse,
  RoomConsent,
  RoomCreate,
  RoomConfig,
} from '@daisy/protocol';

export type Caller = { readonly userId: string; readonly actorId: string };
export type Store = Pick<
  Database,
  | 'readLaunchedRound'
  | 'databaseNow'
  | 'listRoomCatalogSources'
  | 'listRoomBots'
  | 'getFormatRevision'
  | 'getCurrentPreset'
  | 'readRoomCreateReceipt'
  | 'createRoomCommand'
  | 'readRoomAssembly'
  | 'listRoomAssemblies'
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
  const consentOf = async (state: RoomAssemblyState): Promise<RoomConsent> => {
    try {
      return {
        available: true,
        readyActorIds: await redis.readRoomConsent(
          state.id,
          state.version,
          state.participants
            .filter((p) => p.kind === 'human')
            .map((p) => ({
              actorId: p.actorId,
              commandId: p.consentCommandId,
            })),
        ),
      };
    } catch {
      return { available: false, readyActorIds: [] };
    }
  };
  const view = async (caller: Caller, roomId: string) => {
    const state = eligible(
      await store.readRoomAssembly(roomId, caller, (state, account) =>
        can(caller, 'room.read', account, state),
      ),
    );
    return projectRoom(
      state,
      caller.actorId,
      await consentOf(state),
      await store.databaseNow(),
    );
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
  return {
    view,
    roundView: (caller: Caller, roundId: string) =>
      store.readLaunchedRound(
        roundId,
        caller,
        (view, account) =>
          authorize({
            principal: { kind: 'user', ...caller },
            capability: 'round.read',
            context: { account },
            resource: {
              kind: 'round',
              roundId: view.id,
              createdByActorId: view.hostActorId,
              visibility: view.visibility,
              status: view.status,
              participants: view.participants,
              revision: view.version,
            } satisfies RoundAuthorizationFact,
          }).allow,
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
    async list(caller: Caller) {
      const states = await store.listRoomAssemblies(
        caller,
        (state, account) => can(caller, 'room.read', account, state),
        (account) => can(caller, 'room.list', account),
      );
      const now = await store.databaseNow();
      return Promise.all(
        states.map(async (state) =>
          projectRoom(
            eligible(state),
            caller.actorId,
            await consentOf(state),
            now,
          ),
        ),
      );
    },
    async create(
      caller: Caller,
      body: RoomCreate,
    ): Promise<RoomCommandResponse> {
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
