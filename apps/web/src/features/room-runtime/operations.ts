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
import {
  activeRoomMembers,
  executeRoomCommand,
  hostIdentityHidden,
  projectActiveRoom,
  projectRoom,
  decideRoomResolution,
} from '@daisy/debate-engine';
import type { IdGenerator } from '@daisy/clock';
import type { createRedis } from '@daisy/redis';
import type {
  ActiveRoom,
  RoomListQuery,
  RoomAssemblyState,
  RoomCatalogChoice,
  RoomCastChoice,
  RoomCommandResponse,
  RoomCreate,
  PublishedResolution,
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
  | 'getFormatSelectionFacts'
  | 'listPublishedResolutions'
  | 'getPublishedResolution'
  | 'readRoomCreateReceipt'
  | 'createRoomCommand'
  | 'readRoomAssembly'
  | 'readRoomAssemblyFacts'
  | 'listRoomPage'
  | 'executeRoomCommand'
  | 'readActiveRoomFacts'
>;
type Redis = Pick<
  ReturnType<typeof createRedis>,
  'setRoomConsent' | 'readRoomConsent'
>;
export function createRoomRuntimeOperations({
  store,
  redis,
  ids,
  consentTtlMs,
  botsAvailable,
  entropy,
}: {
  readonly store: Store;
  readonly redis: Redis;
  readonly ids: IdGenerator;
  readonly consentTtlMs: () => number;
  readonly botsAvailable: () => boolean;
  /** 32 CSPRNG bytes as hex, for a draw's seed and salt; fixed in tests. */
  readonly entropy: () => string;
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
    const facts = await store.readRoomAssemblyFacts(
      roomId,
      caller,
      (state, account) => can(caller, 'room.read', account, state),
    );
    const state = eligible(facts.state);
    const consent = await consentOf(state, await store.databaseNow());
    const now = await store.databaseNow();
    return {
      ...projectRoom(
        state,
        caller.actorId,
        currentRoomConsent(consent, now),
        now,
        facts.drawSeed,
      ),
      botAdmission: await roomBotAdmission(state, caller.actorId, (actorId) =>
        store.readRoundBotAdmissionStatus(actorId),
      ),
    };
  };
  /** The picker's catalog: role-bearing formats at their canonical presets (FMT-1). */
  const catalog = async (
    caller: Caller,
  ): Promise<{
    readonly choices: readonly RoomCatalogChoice[];
    readonly resolutions: readonly PublishedResolution[];
  }> => {
    const sources = await store.listRoomCatalogSources(caller, (account) =>
      can(caller, 'room.list', account),
    );
    const choices = sources.map((source) => ({
      formatId: source.id,
      formatVersion: source.version,
      label: source.name,
      role: source.role,
      family: source.family,
      leagues: source.leagues,
      searchTerms: source.searchTerms,
      sortOrder: source.sortOrder,
      rulesEdition: source.rulesEdition,
      sourceUrl: source.sourceUrl,
      definition: source.definition,
      preset: {
        version: source.preset.version,
        config: source.preset.config,
        rankedEligible: source.preset.rankedEligible,
      },
    }));
    return { choices, resolutions: await store.listPublishedResolutions() };
  };
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
      basis,
      competitionType,
      resolved,
      recheck,
    } = await resolveRoomSelection(body, store, ids);
    const resolutionSelection = body.resolution;
    const publication =
      resolutionSelection.kind === 'policy' ||
      resolutionSelection.kind === 'value'
        ? await store.getPublishedResolution(
            resolutionSelection.id,
            resolutionSelection.kind,
          )
        : null;
    const resolution = decideRoomResolution({
      selection: resolutionSelection,
      publication,
      formatId,
      standard:
        selection.kind !== 'custom' &&
        ['policy', 'value', 'freestyle'].includes(formatId),
      strikes: resolved.roomPlan.resolutionDraw.enabled,
    });
    if (!resolution.ok) throw createAppError('CONFLICT', 'illegal-config');
    // Each requested actor at most once: assign-seat would move, not
    // reject, a repeat, so the cast refuses duplicates up front.
    const cast = body.cast ?? [];
    if (new Set(cast.map((seat) => seat.actorId)).size !== cast.length)
      throw createAppError('CONFLICT', 'illegal-config');
    const receipt = await store.createRoomCommand({
      caller,
      authorize: (account) => can(caller, 'room.create', account),
      // A new Room holds its host alone; another Room holding them refuses it.
      members: activeRoomMembers({
        status: 'assembling',
        roundRef: null,
        hostActorId: caller.actorId,
        participants: [],
      }),
      commandId: body.commandId,
      payloadDigest: digest(body),
      definition: selection.kind === 'custom' ? definition : null,
      resolutionPublication: publication && {
        id: publication.id,
        kind: publication.kind,
      },
      selection: recheck,
      cast: cast.length
        ? {
            seats: cast.map((seat) => ({
              ...seat,
              commandId: ids.next(),
              participantId: ids.next(),
            })),
            apply: (state, seat, target, now) =>
              executeRoomCommand(
                state,
                caller.actorId,
                {
                  type: 'assign-seat',
                  commandId: seat.commandId,
                  expectedVersion: state.version,
                  actorId: seat.actorId,
                  role: seat.role,
                  slot: seat.slot,
                },
                // Seating never reads consent; Ready stays the human's act.
                { available: true, readyActorIds: [] },
                {
                  now,
                  participantId: seat.participantId,
                  formatId: '',
                  target: target
                    ? {
                        ...target,
                        id: seat.participantId,
                        consentVersion: 0,
                        role: seat.role,
                        slot: seat.slot,
                        eligible: target.eligible,
                      }
                    : null,
                  drawSeed: null,
                  drawStart: null,
                },
              ),
          }
        : null,
      room: {
        id: ids.next(),
        hostActorId: caller.actorId,
        title: body.title,
        topic: resolution.topic,
        publishedResolutionId: resolution.publishedResolutionId,
        visibility: body.visibility,
        formatId,
        formatVersion,
        presetVersion,
        basis,
        competitionType,
        config,
        executionPlan: resolved.roomPlan,
        rules: resolved.rules,
      },
    });
    return { receipt, view: await view(caller, receipt.roomId) };
  };
  return {
    view,
    /** The caller's own active Room (ADR 0070), or null when none holds them. */
    async activeRoom(caller: Caller): Promise<ActiveRoom | null> {
      const facts = await store.readActiveRoomFacts(caller, (account) =>
        can(caller, 'room.list', account),
      );
      return facts && projectActiveRoom(facts, caller.actorId);
    },
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
      ).flatMap((p) =>
        p.kind === 'bot' && p.seatRole
          ? [
              {
                actorId: p.actorId,
                kind: 'bot' as const,
                label: p.label,
                seatRole: p.seatRole,
                eligible: p.eligible && botsAvailable(),
                ...(p.persona ? { persona: p.persona } : {}),
                ...(p.difficulty ? { difficulty: p.difficulty } : {}),
              },
            ]
          : [],
      );
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
      entropy,
    }),
  };
}
export type RoomRuntimeOperations = ReturnType<
  typeof createRoomRuntimeOperations
>;
