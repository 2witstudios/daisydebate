import { settingRow } from './setting-facts';
import { createdSides } from '../../room-runtime/created-sides';
import { orderedWordings } from './resolution-wording-order';
import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  type TabStore,
  type LobbyRoomAssembly,
} from '@daisy/db/tab';
import {
  activeRoomMembers,
  executeRoomCommand,
  resolveRoomConfiguration,
  decideRoomResolution,
} from '@daisy/debate-engine';
import { createAppError } from '@daisy/errors';
import { isDebatingSeat } from '@daisy/protocol';
import {
  commandReplay,
  type LobbyCommandAnswer,
  type LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import {
  lobbySetupCommandEnvelopeSchema,
  lobbySetupCommandCatalogue,
} from '@daisy/protocol/lobby/lobby-setup-command';
import {
  sameSettingValue,
  resolveSetting,
  roomChain,
} from '@daisy/protocol/setting-resolution';
import type { ReleaseAudience } from '@daisy/protocol/release-audience';
import { decideLobby, type LobbyFacts } from '../commands/lobby';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import { resolveRoomSelection } from '../../room-runtime/selection';
import { createNoticeOf } from '../../room-runtime/ready-agreements';
import { hostHoldsCasualCapture } from '../../room-runtime/capture-offer';
import { hostLobbyResource } from './host-lobby-resource';
import {
  standingRoomSettings,
  standingRoomConfig,
} from './standing-room-settings';
import { commandDigest } from './command-digest';
import type { TabPrincipal } from '../tab-principal';

const impossible = (): never => {
  throw createAppError(
    'INVARIANT',
    'Standing Room creation has no fixture conflict',
  );
};
/** A league member's Room uses the ordinary format/compiler/seating owners and one Tab receipt. */
export const createLobbyRoom =
  (dependencies: {
    readonly store: Pick<TabStore, 'createLobbyRoom'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: () => string;
    readonly newId: () => string;
    readonly betaGrantsPremium?: boolean;
  }) =>
  async (
    principal: TabPrincipal,
    body: unknown,
  ): Promise<LobbyCommandAnswer<string>> => {
    const parsed = lobbySetupCommandEnvelopeSchema.safeParse(body);
    if (!parsed.success || parsed.data.command.type !== 'create-lobby-room')
      throw createAppError('VALIDATION');
    if (principal.actorId === null) throw new CommandDenied('not-found');
    const command = parsed.data.command;
    if (command.room.commandId !== parsed.data.commandId)
      throw createAppError('VALIDATION');
    const actorId = principal.actorId;
    try {
      return await dependencies.store.createLobbyRoom(
        {
          senderUserId: principal.userId,
          senderActorId: actorId,
          commandId: parsed.data.commandId,
          command,
        },
        async (session) => {
          const loaded = await session.load();
          if (
            !loaded?.authorization.organization ||
            !loaded.lobby.ownerOrganizationId
          )
            throw new CommandDenied('not-found');
          const now = await session.now();
          const posting = resolveSetting(
            'audience.posting',
            roomChain({
              organizationId: loaded.lobby.ownerOrganizationId,
              templateId: command.templateId,
              lobbyId: loaded.lobby.id,
            }),
            loaded.graph.settings.map(settingRow),
          ).value;
          const hosted = hostLobbyResource(
            loaded.lobby,
            loaded.authorization.organization,
            null,
          );
          if (hosted.kind !== 'lobby') throw new CommandDenied('not-found');
          const authority = {
            principal,
            resource: {
              ...hosted,
              viewing: {
                audiences: loaded.authorization.organization.member
                  ? ['participants' as const]
                  : [],
                releases: [],
              },
              postingAudiences: (
                Object.keys(posting) as ReleaseAudience[]
              ).filter((audience) => posting[audience] !== 'never'),
            },
            context: {
              account: loaded.authorization.account,
              grants: loaded.authorization.grants,
              now,
            },
          };
          if (
            !dependencies.authorize({
              ...authority,
              capability: 'lobby.room.create',
            }).allow ||
            !dependencies.authorize({
              principal,
              capability: 'room.create',
              resource: { kind: 'room_collection' },
              context: { account: loaded.authorization.account },
            }).allow
          )
            throw new CommandDenied('not-found');
          const replay = commandReplay(
            await session.stored(parsed.data.commandId),
            {
              actorUserId: principal.userId,
              payloadDigest: commandDigest({
                expected: parsed.data.expected,
                command,
              }),
            },
          );
          if (replay.kind === 'replay')
            return { kind: 'accepted', receipt: replay.receipt };
          if (replay.kind === 'conflict')
            return { kind: 'refused', refusal: 'command-conflict' };
          if (replay.kind === 'pending' || replay.kind === 'settled')
            return replay;
          const selected = await resolveRoomSelection(
            command.room,
            { getFormatSelectionFacts: session.selectionFacts },
            { next: dependencies.newId },
          );
          const resolved = standingRoomSettings(
            loaded,
            command.templateId,
            selected.config,
          );
          if (!resolved) throw new CommandDenied('not-found');
          const visibility = resolved.settings['room.visibility'];
          const facts: LobbyFacts = {
            now,
            newId: dependencies.newId(),
            actorUserId: principal.userId,
            handleTaken: false,
            organization: {
              id: loaded.lobby.ownerOrganizationId,
              kind: 'league',
            },
            lobby: {
              id: loaded.lobby.id,
              kind: 'standing',
              ownerOrganizationId: loaded.lobby.ownerOrganizationId,
              closedAt: loaded.lobby.closedAt?.toISOString() ?? null,
              version: loaded.lobby.version,
            },
            activity: {
              liveRoundCount: 0,
              unresultedFixtureCount: 0,
              unstartedEventRoomIds: [],
            },
            activeSeasonId: null,
            season: null,
            ladder: null,
            room: {
              offeredTemplates: loaded.graph.templates
                .filter(
                  (row) =>
                    loaded.offered.some(
                      (offer) => offer.templateId === row.id,
                    ) && row.retiredAt === null,
                )
                .map((row) => ({
                  id: row.id,
                  formatId: row.formatId,
                  formatVersion: row.formatVersion,
                  ballotDefinitionId: row.ballotDefinitionId,
                  ballotDefinitionVersion: row.ballotDefinitionVersion,
                })),
              ownFormat: resolved.settings['room.own_format'].value.value,
              ownText: resolved.settings['resolution.own_text'].value.value,
              enforcedVisibility:
                visibility.hold === 'enforced' ? visibility.value.value : null,
              poolResolutions: loaded.resolutions,
            },
          };
          const expectedConfig = standingRoomConfig(
            selected.config,
            resolved,
            loaded.resolutions,
          );
          const config = command.config;
          const rule = resolved.settings['resolution.rule'].value;
          const pool = command.poolResolutionId
            ? loaded.resolutions.find(
                (row) => row.id === command.poolResolutionId,
              )
            : undefined;
          const poolChoice =
            rule.method === 'draw'
              ? orderedWordings(
                  loaded.resolutions,
                  dependencies.newId(),
                  loaded.lobby.id,
                )[0]
              : pool;
          const resolution = decideRoomResolution({
            selection: poolChoice
              ? { kind: 'custom', text: poolChoice.text }
              : command.room.resolution,
            standard: false,
            strikes: rule.method === 'strike',
          });
          const compiled = resolveRoomConfiguration(
            selected.definition,
            config,
          );
          const recording =
            command.room.recordingPolicy &&
            command.room.recordingPolicy !== 'off'
              ? command.room.recordingPolicy
              : null;
          const capture = recording
            ? { broadcast: null, recordingPolicy: recording }
            : null;
          const notice = createNoticeOf(
            { competitionType: selected.competitionType, capture },
            command.room.noticeVersion,
          );
          let assembly: LobbyRoomAssembly | null = null;
          const envelope = { ...parsed.data, command };
          let appliedReceipt: LobbyCommandReceipt | null = null;
          const answer = await runLobbyCommand<
            typeof command,
            LobbyFacts,
            string,
            Extract<
              ReturnType<typeof decideLobby>,
              { kind: 'accepted' }
            >['writes'][number]
          >(
            {
              authorize: dependencies.authorize,
              digest: commandDigest,
              now: () => now,
              transaction: (work) =>
                work({
                  stored: session.stored,
                  facts: async () => facts,
                  authority: () => authority,
                  versions: () => ({}),
                  scope: () => ({ kind: 'lobby', lobbyId: loaded.lobby.id }),
                  recordConflict: impossible,
                  holdForConfirmation: impossible,
                  apply: async (_writes, history, receipt) => {
                    if (!assembly)
                      throw createAppError(
                        'INVARIANT',
                        'Accepted Room has no resolved assembly',
                      );
                    appliedReceipt = await session.apply(
                      assembly,
                      history,
                      receipt,
                      selected.selection.kind === 'custom'
                        ? selected.definition
                        : null,
                      notice.kind === 'shown'
                        ? {
                            id: dependencies.newId(),
                            version: notice.notice.version,
                            words: notice.notice.text,
                          }
                        : null,
                      recording || command.room.postRoundCall
                        ? (grants, at) =>
                            hostHoldsCasualCapture(
                              grants,
                              dependencies.betaGrantsPremium ?? false,
                              at,
                            )
                        : undefined,
                    );
                  },
                }),
            },
            envelope,
            lobbySetupCommandCatalogue['create-lobby-room'],
            () => {
              const decision = decideLobby(facts, command);
              if (decision.kind !== 'accepted') return decision;
              const recordingSetting = resolved.settings['recording.capture'];
              if (
                recordingSetting.hold === 'enforced' &&
                (recording !== null) !== (recordingSetting.value.value === 'on')
              )
                return { kind: 'refused', refusal: 'setting-enforced' };
              if (
                selected.competitionType === 'ranked' ||
                !sameSettingValue(config, expectedConfig)
              )
                return { kind: 'refused', refusal: 'setting-enforced' };
              const ladder =
                resolved.settings['standings.rating_ladder'].value.ladderId;
              if (
                ladder === loaded.ladder?.id &&
                (selected.definition.outcome.kind !== 'winner' ||
                  selected.definition.sides.length !== 2)
              )
                return {
                  kind: 'refused',
                  refusal: 'rating-format-unsupported',
                };
              if (!compiled.ok || !resolution.ok || notice.kind === 'refused')
                return { kind: 'refused', refusal: 'setting-enforced' };
              if (
                rule.method === 'fixed' &&
                command.room.resolution.kind === 'strike'
              )
                return { kind: 'refused', refusal: 'pool-resolution-required' };
              if (
                rule.method !== 'fixed' &&
                (command.room.resolution.kind !== 'strike' ||
                  command.poolResolutionId)
              )
                return { kind: 'refused', refusal: 'pool-resolution-required' };
              if (
                rule.method === 'strike' &&
                (!config.resolutionDraw.enabled ||
                  loaded.resolutions.length < rule.drawSize)
              )
                return { kind: 'refused', refusal: 'pool-resolution-required' };
              if (rule.method === 'draw' && !poolChoice)
                return { kind: 'refused', refusal: 'pool-resolution-required' };
              const write = decision.writes.find(
                (write) => write.table === 'rooms' && write.op === 'insert',
              );
              if (!write || write.table !== 'rooms' || write.op !== 'insert')
                throw createAppError('INVARIANT');
              const cast = command.room.cast ?? [];
              assembly = {
                room: {
                  id: write.row.id,
                  hostActorId: actorId,
                  // A league's Rooms are in its division (ADR 0156).
                  division: loaded.division,
                  title: command.room.title,
                  topic: resolution.topic,
                  visibility: command.room.visibility,
                  formatId: selected.formatId,
                  formatVersion: selected.formatVersion,
                  presetVersion: selected.presetVersion,
                  basis: selected.basis,
                  competitionType: selected.competitionType,
                  teamOneSide: createdSides({
                    competitionType: selected.competitionType,
                    sides: undefined,
                    castNamesDebater: cast.some((seat) =>
                      isDebatingSeat(seat.seat),
                    ),
                    seating: compiled.rules,
                  }),
                  config,
                  executionPlan: compiled.roomPlan,
                  rules: compiled.rules,
                },
                lobby: { id: loaded.lobby.id, kind: 'standing' },
                templateId: write.row.templateId,
                ballotDefinition: write.row.ballotDefinitionId
                  ? {
                      id: write.row.ballotDefinitionId,
                      version: write.row.ballotDefinitionVersion!,
                    }
                  : null,
                capture,
                postRoundCall: command.room.postRoundCall === true,
                now,
                caller: { userId: principal.userId, actorId },
                ...(command.room.holdSeatsFor
                  ? { holdSeatsFor: command.room.holdSeatsFor }
                  : {}),
                membersOf: (participants) =>
                  activeRoomMembers({
                    status: 'assembling',
                    roundRef: null,
                    participants,
                  }),
                cast: cast.length
                  ? {
                      seats: cast.map((seat) => ({
                        ...seat,
                        commandId: dependencies.newId(),
                        participantId: dependencies.newId(),
                      })),
                      apply: (state, seat, target, at, maySeatCasualAiJudge) =>
                        executeRoomCommand(
                          state,
                          actorId,
                          {
                            type: 'assign-seat',
                            commandId: seat.commandId,
                            expectedVersion: state.version,
                            actorId: seat.actorId,
                            seat: seat.seat,
                          },
                          { available: true, readyActorIds: [] },
                          {
                            now: at,
                            participantId: seat.participantId,
                            roundId: null,
                            formatId: '',
                            hostMaySeatCasualAiJudge: maySeatCasualAiJudge,
                            hostHoldsCasualCapture: false,
                            target: target
                              ? {
                                  ...target,
                                  id: seat.participantId,
                                  consentVersion: 0,
                                  seat: seat.seat,
                                  teamOpen: false,
                                  positionOpen: false,
                                }
                              : null,
                            drawStart: null,
                            seatSeed: null,
                          },
                        ),
                    }
                  : null,
              };
              return decision;
            },
          );
          return answer.kind === 'accepted' && appliedReceipt
            ? { ...answer, receipt: appliedReceipt }
            : answer;
        },
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };
