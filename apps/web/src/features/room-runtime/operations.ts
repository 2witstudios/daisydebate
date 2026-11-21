import { createAppError, createRefusal } from '@daisy/errors';
import { canOfferFreshRoom } from './fresh-room';
import { roomBotAdmission } from './bot-admission';
import { roomAiJudgeSeating } from './ai-judge-seating';
import { hostHoldsCasualCapture, roomCaptureOffer } from './capture-offer';
import { authorize } from '@daisy/auth/authorization';
import { roomCommandOperation } from './command';
import { aiServesSeat } from './ai-seat';
import type { AiSeatAvailability } from '../../server/round-worker-policy';
import { currentRoomConsent, type PreparedRoomConsent } from './consent';
import { can, digest } from './authority';
import { resolveRoomSelection } from './selection';
import {
  createNoticeOf,
  requiredContentWaiver,
  roomCaptureNotice,
} from './ready-agreements';
import type { Database } from '@daisy/db';
import { standardFormatIds } from '@daisy/db/catalog-formats';
import {
  readRoundOpeningTopic,
  activeRoomMembers,
  executeRoomCommand,
  hostIdentityHidden,
  projectActiveRoom,
  projectRoom,
  startHiddenFrom,
  decideRoomResolution,
} from '@daisy/debate-engine';
import type { IdGenerator } from '@daisy/clock';
import { spectatorClockAt } from '../spectating/spectator-clock';
import { withSeatRatings } from '../ratings/room-seat-ratings';
import { replayPublishedStandings } from '../ratings/replay-published-standings';
import type { createRedis } from '@daisy/redis';
import type {
  ActiveRoom,
  AgeBand,
  HostedRoom,
  RoomListQuery,
  RoomAssemblyState,
  RoomCatalogChoice,
  RoomCastChoice,
  RoomCommandResponse,
  RoomCreate,
  RoomView,
} from '@daisy/protocol';
import {
  isDebatingSeat,
  isOpenRoomStatus,
  isRoundOver,
  type RoomWatch,
} from '@daisy/protocol';
import { liveAudience } from '@daisy/auth/live-audience';
import type { LinkedAdultsOf } from '../spectating/linked-adults';
import { createdSides } from './created-sides';

export type Caller = { readonly userId: string; readonly actorId: string };

/** Whether a catalog format is Daisy's standard, Freestyle (ADR 0142). */
const isStandardFormat = (formatId: string) =>
  (standardFormatIds as readonly string[]).includes(formatId);
export type Store = Pick<
  Database,
  | 'readRoomInvitations'
  | 'readRoundBotAdmissionStatus'
  | 'readOwnEntitlementGrants'
  | 'readOwnCasualJudgeAllowance'
  | 'databaseNow'
  | 'listRoomCatalogSources'
  | 'listRoomBots'
  | 'getFormatRevision'
  | 'getFormatSelectionFacts'
  | 'readRoomCreateReceipt'
  | 'createRoomCommand'
  | 'readRoomAssembly'
  | 'readRoomAssemblyFacts'
  | 'listRoomPage'
  | 'executeRoomCommand'
  | 'readActiveRoomFacts'
  | 'listHostedRooms'
  | 'readContentWaiverStanding'
  | 'readWatchableRoundOfRoom'
  | 'readMemberCardRatings'
  | 'readRatingBlindings'
>;
type Redis = Pick<
  ReturnType<typeof createRedis>,
  'setRoomConsent' | 'readRoomConsent'
>;
export function createRoomRuntimeOperations({
  store,
  redis,
  ids,
  now,
  consentTtlMs,
  aiSeats,
  betaGrantsPremium,
  entropy,
  linkedAdults,
}: {
  readonly store: Store;
  readonly redis: Redis;
  readonly ids: IdGenerator;
  /** A listed host's rating waits for the spectator timeline. */
  readonly now: () => string;
  readonly consentTtlMs: () => number;
  readonly aiSeats: () => AiSeatAvailability;
  /** Whether a beta-sourced premium grant counts (`PREMIUM_BETA_GRANT`). */
  readonly betaGrantsPremium: boolean;
  /** 32 CSPRNG bytes as hex, for a draw's seed and salt; fixed in tests. */
  readonly entropy: () => string;
  /** A Youth Round's linked adults, who watch it from its Room (ADR 0155). */
  readonly linkedAdults: LinkedAdultsOf;
}) {
  /**
   * Where someone outside a started Room watches its Round: its released
   * Broadcast, or a live Youth Round's room for a youth debater's linked
   * adult (ADR 0155), whose links are read only once no Broadcast answers.
   */
  const watchOf = async (
    state: RoomAssemblyState,
    actorId: string,
    now: string,
  ): Promise<RoomWatch | null> => {
    if (!startHiddenFrom(state, actorId)) return null;
    const released = await store.readWatchableRoundOfRoom(
      state.id,
      spectatorClockAt(now),
    );
    if (released !== null) return { kind: 'broadcast', roundId: released };
    const round = state.roundRef;
    if (round === null || isRoundOver(round.status)) return null;
    // A lookup that fails only means no live-room link: the Room read stands.
    const youth = await linkedAdults(round.id).catch(() => null);
    return youth !== null &&
      liveAudience(
        {
          createdByActorId: state.hostActorId,
          status: round.status,
          participants: state.participants,
          youth,
        },
        { kind: 'account', actorId },
      ).kind === 'undelayed_no_media'
      ? { kind: 'live_room', roundId: round.id }
      : null;
  };
  const eligible = (state: RoomAssemblyState): RoomAssemblyState => ({
    ...state,
    participants: state.participants.map((p) => ({
      ...p,
      eligible:
        p.eligible &&
        (p.kind === 'human' || aiServesSeat(aiSeats(), p.seat.kind)),
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
  /**
   * Only a seated human on an open ranked Room stands on the waiver: the one
   * their age band requires (ADR 0161).
   */
  const viewerContentWaiver = async (
    state: RoomAssemblyState,
    caller: Caller,
    ageBand: AgeBand | null,
  ): Promise<Pick<RoomView, 'contentWaiver' | 'contentWaiverVersion'>> => {
    const none = { contentWaiver: null, contentWaiverVersion: null };
    if (
      state.competitionType !== 'ranked' ||
      !isOpenRoomStatus(state.status) ||
      !state.participants.some(
        (p) => p.actorId === caller.actorId && p.kind === 'human',
      )
    )
      return none;
    const version = requiredContentWaiver(state, ageBand);
    if (!version) return none;
    const standing = await store.readContentWaiverStanding(
      caller.userId,
      version,
      state.lobbyId,
    );
    return standing === 'no-active-season'
      ? none
      : { contentWaiver: standing, contentWaiverVersion: version };
  };
  const view = async (caller: Caller, roomId: string, eventOnly = false) => {
    const facts = await store.readRoomAssemblyFacts(
      roomId,
      caller,
      (state, account, direction, now) =>
        (!eventOnly || direction != null) &&
        can(caller, 'room.read', account, state, direction, now),
      readRoundOpeningTopic,
    );
    const state = eligible(facts.state);
    const consent = await consentOf(state, await store.databaseNow());
    const now = await store.databaseNow();
    return {
      ...(await withSeatRatings(
        projectRoom(
          state,
          caller.actorId,
          currentRoomConsent(consent, now),
          now,
        ),
        {
          // A seat's rating waits for the spectator timeline, as a card's does.
          ratings: (actorIds) =>
            store.readMemberCardRatings(
              actorIds,
              spectatorClockAt(now),
              replayPublishedStandings,
            ),
          blinded: () => store.readRatingBlindings(caller.actorId),
        },
        now,
      )),
      aiJudgeSeating: await roomAiJudgeSeating(state, caller.actorId, () =>
        store.readOwnCasualJudgeAllowance(
          caller,
          state.participants.some(
            (seat) => seat.kind === 'bot' && isDebatingSeat(seat.seat),
          ),
        ),
      ),
      ...(await viewerContentWaiver(state, caller, facts.viewerAgeBand)),
      captureOffer: await roomCaptureOffer(state, caller.actorId, async () =>
        hostHoldsCasualCapture(
          await store.readOwnEntitlementGrants(caller),
          betaGrantsPremium,
          await store.databaseNow(),
        ),
      ),
      captureNotice: roomCaptureNotice(state),
      botAdmission: await roomBotAdmission(state, caller.actorId, (actorId) =>
        store.readRoundBotAdmissionStatus(actorId),
      ),
      // Only an open Room has invitations to show.
      invitations: isOpenRoomStatus(state.status)
        ? [
            ...(await store.readRoomInvitations({
              roomId: state.id,
              viewerActorId: caller.actorId,
              now,
            })),
          ]
        : [],
      watch: await watchOf(state, caller.actorId, now),
    };
  };
  /** The picker's catalog: role-bearing formats at their canonical presets (FMT-1). */
  const catalog = async (
    caller: Caller,
  ): Promise<{
    readonly choices: readonly RoomCatalogChoice[];
    /** The caller may include the AI judge in a new bot debate. */
    readonly botDebateAiJudge: boolean;
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
    return {
      choices,
      botDebateAiJudge:
        (await store.readOwnCasualJudgeAllowance(caller, true)).kind ===
        'admit',
    };
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
    if (
      competitionType === 'ranked' &&
      (body.recordingPolicy !== undefined || body.postRoundCall === true)
    )
      throw createRefusal('CONFLICT', 'illegal-config');
    // A Room recorded at all is created with its Recording policy; `off` records nothing.
    const recordingPolicy =
      body.recordingPolicy === undefined || body.recordingPolicy === 'off'
        ? null
        : body.recordingPolicy;
    const createNotice = createNoticeOf(
      {
        competitionType,
        capture: recordingPolicy ? { broadcast: null, recordingPolicy } : null,
      },
      body.noticeVersion,
    );
    if (createNotice.kind === 'refused')
      throw createRefusal('CONFLICT', 'capture-notice-changed');
    const resolution = decideRoomResolution({
      selection: body.resolution,
      standard: selection.kind !== 'custom' && isStandardFormat(formatId),
      strikes: resolved.roomPlan.resolutionDraw.enabled,
    });
    if (!resolution.ok) throw createRefusal('CONFLICT', 'illegal-config');
    // Each requested actor at most once: assign-seat would move, not
    // reject, a repeat, so the cast refuses duplicates up front.
    const cast = body.cast ?? [];
    if (new Set(cast.map((seat) => seat.actorId)).size !== cast.length)
      throw createRefusal('CONFLICT', 'illegal-config');
    const receipt = await store.createRoomCommand({
      caller,
      // The Room opens in the creator's own lobby unless club staff chose
      // Youth (ADR 0156); the store decides under the account lock.
      lobbyChoice: body.lobby ?? null,
      authorize: (account) => can(caller, 'room.create', account),
      // A new Room holds the humans its cast seats, never a host without a
      // seat (TAB-6.16), save a Train practice's creator; another Room
      // holding one of them refuses it.
      membersOf: (participants) =>
        activeRoomMembers({
          status: 'assembling',
          roundRef: null,
          participants,
          // A Train practice holds its creator from create (decision 75).
          hostActorId: caller.actorId,
          holdsHost: body.practice === true,
        }),
      commandId: body.commandId,
      payloadDigest: digest(body),
      definition: selection.kind === 'custom' ? definition : null,
      selection: recheck,
      ...(recordingPolicy
        ? {
            recording: {
              policy: recordingPolicy,
              authorize: (grants, now) =>
                hostHoldsCasualCapture(grants, betaGrantsPremium, now),
            },
          }
        : {}),
      ...(body.holdSeatsFor ? { holdSeatsFor: body.holdSeatsFor } : {}),
      ...(body.postRoundCall ? { postRoundCall: true } : {}),
      notice:
        createNotice.kind === 'shown'
          ? {
              id: ids.next(),
              version: createNotice.notice.version,
              words: createNotice.notice.text,
            }
          : null,
      cast: cast.length
        ? {
            seats: cast.map((seat) => ({
              ...seat,
              commandId: ids.next(),
              participantId: ids.next(),
            })),
            apply: (state, seat, target, now, maySeatCasualAiJudge) =>
              executeRoomCommand(
                state,
                caller.actorId,
                {
                  type: 'assign-seat',
                  commandId: seat.commandId,
                  expectedVersion: state.version,
                  actorId: seat.actorId,
                  seat: seat.seat,
                },
                // Seating never reads consent; Ready stays the human's act.
                { available: true, readyActorIds: [] },
                {
                  now,
                  participantId: seat.participantId,
                  // Seating launches no Round.
                  roundId: null,
                  formatId: '',
                  hostMaySeatCasualAiJudge: maySeatCasualAiJudge,
                  // Seating never reads this; only set-capture and Launch do.
                  hostHoldsCasualCapture: false,
                  target: target
                    ? {
                        ...target,
                        id: seat.participantId,
                        consentVersion: 0,
                        seat: seat.seat,
                        teamOpen: false,
                        positionOpen: false,
                        // Match the ordinary assign-seat command: profile
                        // eligibility is not enough while this seat cannot
                        // run (including direct create requests).
                        eligible:
                          target.eligible &&
                          aiServesSeat(aiSeats(), seat.seat.kind),
                      }
                    : null,
                  drawStart: null,
                  seatSeed: null,
                },
              ),
          }
        : null,
      room: {
        id: ids.next(),
        hostActorId: caller.actorId,
        title: body.title,
        topic: resolution.topic,
        visibility: body.visibility,
        formatId,
        formatVersion,
        presetVersion,
        basis,
        competitionType,
        // The Room remembers it holds its host, through every command.
        holdsHost: body.practice === true,
        teamOneSide: createdSides({
          competitionType,
          sides: body.sides,
          castNamesDebater: cast.some((seat) => isDebatingSeat(seat.seat)),
          seating: resolved.rules,
        }),
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
    /** The open Rooms the caller hosts (TAB-6.16): hosting holds no seat. */
    hostedRooms(caller: Caller): Promise<readonly HostedRoom[]> {
      return store.listHostedRooms(caller, (account) =>
        can(caller, 'room.list', account),
      );
    },
    catalog,
    async castChoices(caller: Caller): Promise<readonly RoomCastChoice[]> {
      return (
        await store.listRoomBots(caller, (account) =>
          can(caller, 'room.list', account),
        )
      ).flatMap((p) =>
        p.kind === 'bot' && p.aiRole
          ? [
              {
                actorId: p.actorId,
                kind: 'bot' as const,
                label: p.label,
                aiRole: p.aiRole,
                eligible: p.eligible && aiSeats()[p.aiRole],
                ...(p.persona ? { persona: p.persona } : {}),
                ...(p.difficulty ? { difficulty: p.difficulty } : {}),
              },
            ]
          : [],
      );
    },
    async list(caller: Caller, query: RoomListQuery) {
      const clock = spectatorClockAt(now());
      const page = await store.listRoomPage(
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
        clock,
        readRoundOpeningTopic,
      );
      const visibleHosts = [
        ...new Set(
          page.rooms.flatMap((room) =>
            room.competitionType === 'ranked' && room.hostActorId
              ? [room.hostActorId]
              : [],
          ),
        ),
      ];
      if (visibleHosts.length === 0) return page;
      const published = await store.readMemberCardRatings(
        visibleHosts,
        clock,
        replayPublishedStandings,
      );
      return {
        ...page,
        rooms: page.rooms.map((room) => {
          if (room.competitionType !== 'ranked' || !room.hostActorId)
            return room;
          const rating = published.find(
            (row) =>
              row.actorId === room.hostActorId && row.lobbyId === room.lobbyId,
          );
          return {
            ...room,
            hostRating: rating ? Math.round(rating.rating) : null,
          };
        }),
      };
    },
    create,
    async rematch(caller: Caller, sourceRoomId: string, body: RoomCreate) {
      const source = await store.readRoomAssembly(
        sourceRoomId,
        caller,
        (state, account, direction, now) =>
          can(caller, 'room.read', account, state, direction, now),
        readRoundOpeningTopic,
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
      aiSeats,
      betaGrantsPremium,
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
