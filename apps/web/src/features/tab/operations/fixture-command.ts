import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  EventSettingParentsChanged,
  FixturePeopleChanged,
  type TabStore,
  type LoadedFixtureCommand,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  fixtureCommandEnvelopeSchema,
  fixtureCommandDefinition,
} from '@daisy/protocol/lobby/fixture-command';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import type { FixtureWrite } from '@daisy/db/tab';
import type { FixtureCommandRefusal } from '@daisy/protocol/lobby/fixture-command';
import { decideFixture } from '../commands/fixture';
import { hostLobbyResource } from './host-lobby-resource';
import { fixtureFacts } from './fixture-facts';
import { fixtureRestartRoom } from './fixture-restart-room';
import { eligibleTournamentActors } from './tournament-participant-admission';
import { participantAccess } from '@daisy/auth/authorization';
import {
  activeRoomMembers,
  afterRoomJudgeChange,
  closeRoom,
  createRoundRuntime,
  judgingJobEndReason,
} from '@daisy/debate-engine';
import { eventSettingResolution } from './event-setting-resolution';
import { commandDigest } from './command-digest';
import type { TabPrincipal } from '../tab-principal';

/** Addressed officiating commands preserve ordinary owner lifecycle and immutable competitive provenance. */
export const fixtureCommand =
  (dependencies: {
    readonly store: Pick<TabStore, 'fixtureCommand'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: () => string;
    readonly newId: () => string;
    readonly confirmationExpiresAt: (now: string) => string;
  }) =>
  async (principal: TabPrincipal, lobbyId: string, body: unknown) => {
    const parsed = fixtureCommandEnvelopeSchema.safeParse(body);
    if (!idSchema.safeParse(lobbyId).success || !parsed.success)
      throw createAppError('VALIDATION');
    const command = parsed.data.command,
      resultId = dependencies.newId(),
      roomId = dependencies.newId();
    try {
      return await dependencies.store.fixtureCommand(
        {
          lobbyId,
          senderUserId: principal.userId,
          command,
          commandId: parsed.data.commandId,
        },
        async (session) => {
          const loaded = await session.load();
          if (!loaded) throw new CommandDenied('not-found');
          const now = loaded.checkedAt;
          const definition = fixtureCommandDefinition(
            command.type,
            loaded.context.fixture.status,
          );
          const competition = loaded.competition;
          const lobby = hostLobbyResource(
            competition.configuration.lobby,
            competition.authorization.organization,
            competition.ownerActorId,
          );
          if (lobby.kind !== 'lobby' || lobby.scope.lobbyKind !== 'tournament')
            throw new CommandDenied('not-found');
          const authority = {
            principal,
            resource: {
              kind: 'fixture' as const,
              fixtureId: competition.fixture.id,
              scope: lobby.scope,
              conflict: {
                connections: competition.connections,
                handling: eventSettingResolution(competition.configuration)
                  .settings['conflict.handling'].value.value,
                waiverId: null,
              },
              viewing: { audiences: [], releases: [] },
            },
            context: {
              account: competition.authorization.account,
              grants: competition.authorization.grants,
              now,
            },
          };
          // A retained receipt is not current authority to access another tenant's history.
          if (
            !definition.gate.some((capability) => {
              const decision = dependencies.authorize({
                ...authority,
                capability,
              });
              return (
                decision.allow || decision.reason === 'confirmation-required'
              );
            })
          )
            throw new CommandDenied('not-found');
          return runLobbyCommand<
            typeof command,
            LoadedFixtureCommand,
            FixtureCommandRefusal | 'not-found',
            FixtureWrite
          >(
            {
              authorize: dependencies.authorize,
              digest: commandDigest,
              now: () => now,
              transaction: (work) =>
                work({
                  stored: session.stored,
                  facts: async () => loaded,
                  authority: () => authority,
                  versions: () => ({ fixture: competition.fixture.version }),
                  scope: () => ({ kind: 'lobby', lobbyId }),
                  recordConflict: (conflict) =>
                    session.recordConflict({
                      conflict,
                      now,
                      newId: dependencies.newId,
                    }),
                  holdForConfirmation: (held) =>
                    session.hold({
                      commandId: held.commandId,
                      type: held.type,
                      payload: held.payload,
                      payloadDigest: held.payloadDigest,
                      expected: held.expected,
                      conflictId: held.conflictId,
                      expiresAt: dependencies.confirmationExpiresAt(now),
                    }),
                  apply: (writes, history, receipt) => {
                    if (!principal.actorId)
                      throw new CommandDenied('not-found');
                    const eligible = eligibleTournamentActors(
                      loaded.context.accounts,
                    );
                    const additions = writes.flatMap((write) =>
                      write.table === 'fixture_judges' && write.op === 'insert'
                        ? loaded.judges
                            .filter(
                              (judge) =>
                                judge.id === write.row.tournamentJudgeId,
                            )
                            .map((judge) => judge.actorId)
                        : [],
                    );
                    if (command.type === 'restart-fixture')
                      additions.push(
                        ...(loaded.roomState?.participants.map(
                          (person) => person.actorId,
                        ) ?? []),
                      );
                    if (additions.some((actor) => !eligible.has(actor)))
                      throw new CommandDenied('judge-unavailable');
                    return session.apply(writes, history, receipt, {
                      actorId: principal.actorId,
                      commandId: parsed.data.commandId,
                      payloadDigest: commandDigest({
                        expected: parsed.data.expected,
                        command,
                      }),
                      newId: dependencies.newId,
                      admits: (access) =>
                        access.ageBand === 'adult' &&
                        participantAccess({
                          ...access,
                          beta: access.beta ? { state: access.beta } : null,
                        }),
                      members: activeRoomMembers,
                      afterJudgeChange: afterRoomJudgeChange,
                      authorize: (at) => {
                        if (
                          !definition.gate.some(
                            (capability) =>
                              dependencies.authorize({
                                ...authority,
                                context: { ...authority.context, now: at },
                                capability,
                              }).allow,
                          )
                        )
                          throw new CommandDenied('not-found');
                      },
                      stopProjection: ({ round, now: at }) =>
                        createRoundRuntime({
                          ...round,
                          round,
                          nextSegmentId: dependencies.newId,
                        }).stop(at),
                      judgingEndReason: judgingJobEndReason,
                      closeRoom,
                      restart:
                        command.type === 'restart-fixture'
                          ? fixtureRestartRoom(
                              loaded,
                              principal,
                              roomId,
                              dependencies.newId,
                            )
                          : null,
                    });
                  },
                }),
            },
            { ...parsed.data, command },
            definition,
            (facts, requested) =>
              decideFixture(
                fixtureFacts(facts, {
                  commandId: parsed.data.commandId,
                  resultId,
                  roomId,
                }),
                requested,
              ),
          );
        },
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return {
          kind: 'refused' as const,
          refusal: 'command-conflict' as const,
        };
      if (
        error instanceof EventSettingParentsChanged ||
        error instanceof FixturePeopleChanged
      )
        throw createAppError('CONFLICT', 'Event settings changed');
      throw error;
    }
  };
