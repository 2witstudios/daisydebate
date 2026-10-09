import {
  authorize,
  type AccountAuthorizationFact,
  type AuthorizationCapability,
} from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';
import {
  executeRoomCommand,
  projectRoom,
  resolveRoomConfiguration,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import type { IdGenerator } from '@daisy/clock';
import type { createRedis } from '@daisy/redis';
import type {
  FormatDefinition,
  RoomAssemblyState,
  RoomCatalogChoice,
  RoomCastChoice,
  RoomCommand,
  RoomCommandResponse,
  RoomConsent,
  RoomCreate,
  RoomConfig,
} from '@daisy/protocol';

type Caller = { readonly userId: string; readonly actorId: string };
type Store = Pick<
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
const roomFact = (state: RoomAssemblyState) => ({
  kind: 'room' as const,
  roomId: state.id,
  hostActorId: state.hostActorId,
  visibility: state.visibility,
  status: state.status,
  revision: state.version,
  participants: state.participants,
});
const can = (
  caller: Caller,
  capability: AuthorizationCapability,
  account: AccountAuthorizationFact | null,
  state?: RoomAssemblyState,
) =>
  authorize({
    principal: { kind: 'user', ...caller },
    capability,
    context: { account },
    resource: state ? roomFact(state) : { kind: 'room_collection' },
  }).allow;
const capabilityOf = (command: RoomCommand): AuthorizationCapability =>
  command.type === 'claim-seat'
    ? 'room.join'
    : command.type === 'ready' || command.type === 'unready'
      ? 'room.ready'
      : command.type === 'leave-seat'
        ? 'room.leave'
        : 'room.manage';
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value: unknown) =>
  new Bun.CryptoHasher('sha3-256').update(canonical(value)).digest('hex');
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
  interruptions: null,
  yielding: null,
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
            },
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
      const selection = body.selection;
      let definition: FormatDefinition;
      let config: RoomConfig;
      let formatId: string;
      let formatVersion: number;
      let presetVersion: number | null = null;
      let competitionType: 'casual' | 'practice' | 'ranked';
      if (selection.kind === 'custom') {
        definition = selection.definition;
        config = selection.config;
        formatId = ids.next();
        formatVersion = 1;
        competitionType = selection.competitionType;
      } else {
        const choice = (await catalog(caller)).find(
          (choice) =>
            choice.formatId === selection.formatId &&
            choice.formatVersion === selection.formatVersion,
        );
        if (!choice) throw createAppError('VALIDATION');
        definition = choice.definition;
        formatId = choice.formatId;
        formatVersion = choice.formatVersion;
        if (selection.kind === 'ranked') {
          const preset = await store.getCurrentPreset(
            formatId,
            selection.length,
          );
          if (
            !preset ||
            preset.version !== selection.presetVersion ||
            preset.formatVersion !== formatVersion ||
            definition.seats.affirmative !== 1 ||
            definition.seats.negative !== 1 ||
            definition.seats.judge !== 1
          )
            throw createAppError('VALIDATION');
          config = preset.config;
          presetVersion = preset.version;
          competitionType = 'ranked';
        } else {
          config = selection.config;
          competitionType = selection.competitionType;
        }
      }
      const resolved = resolveRoomConfiguration(definition, config);
      if (!resolved.ok)
        throw createAppError('VALIDATION', resolved.refusal.kind);
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
    async command(
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
    },
  };
}
export type RoomRuntimeOperations = ReturnType<
  typeof createRoomRuntimeOperations
>;
