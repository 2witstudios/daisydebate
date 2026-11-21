import { freezeTournamentRatings } from '../../ratings/tournament-snapshot';
import { eventSettingResolution } from './event-setting-resolution';
import { eventResultsVersion } from './event-results-version';
import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  DrawPeopleChanged,
  EventSettingParentsChanged,
  type TabStore,
  type LoadedDrawCommand,
  type DrawWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { closeRoom, activeRoomMembers } from '@daisy/debate-engine';
import {
  drawCommandDefinition,
  drawCommandEnvelopeSchema,
  type DrawCommand,
} from '@daisy/protocol/lobby/draw-command';
import {
  commandReplay,
  type LobbyCommandAnswer,
} from '@daisy/protocol/lobby/command';
import { decideDraw } from '../commands/draw';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import type { TabPrincipal } from '../tab-principal';
import { commandDigest } from '@daisy/digest';
import { drawFacts, type DrawCompetition } from './draw-facts';
import { drawAuthority } from './draw-authority';
import { tabEngine } from './tab-engine';
import { eventRoomPins } from './event-room-pins';
import { eventRoomAssemblies } from './event-room-assembly';
import { drawAdmissionsAllowed } from './draw-admission';

type Dependencies = {
  readonly store: Pick<TabStore, 'drawCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly competition: (
    facts: LoadedDrawCommand,
    command: DrawCommand,
  ) => DrawCompetition;
  readonly now: () => string;
  readonly newId: () => string;
};
const neverHeld = (): never => {
  throw createAppError(
    'INVARIANT',
    'Drawing is a fixture-less authority question',
  );
};
/** Draw versions, panels and publication, under the actual account, parent, event and slot fences. */
export const drawCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
    body: unknown,
  ): Promise<LobbyCommandAnswer<string>> => {
    const parsed = drawCommandEnvelopeSchema.safeParse(body);
    if (!idSchema.safeParse(lobbyId).success || !parsed.success)
      throw createAppError('VALIDATION');
    const command = parsed.data.command;
    const publicationEntropy = dependencies.newId();
    try {
      return await dependencies.store.drawCommand(
        { senderUserId: principal.userId, lobbyId, command },
        async (session) => {
          const loaded = await session.load();
          const now = dependencies.now();
          if (!loaded) {
            const current = await session.lobbyAuthority();
            // Published draws are immutable; an absent draw can only have been an unpublished draft.
            const definition = drawCommandDefinition(command.type, 'draft');
            if (
              !current ||
              !definition.gate.some(
                (capability) =>
                  dependencies.authorize({
                    ...drawAuthority(current, principal, current.checkedAt),
                    capability,
                  }).allow,
              )
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
            if (replay.kind === 'pending')
              return {
                kind: 'pending',
                pendingCommandId: replay.pendingCommandId,
                expiresAt: replay.expiresAt,
              };
            if (replay.kind === 'conflict')
              return { kind: 'refused', refusal: 'command-conflict' };
            throw new CommandDenied('not-found');
          }
          if (
            command.type === 'generate-draw' &&
            loaded.ratingSnapshot === null
          ) {
            const definition = drawCommandDefinition(command.type, 'draft');
            const authority = drawAuthority(
              {
                lobby: loaded.configuration.lobby,
                authorization: loaded.authorization,
                ownerActorId: loaded.ownerActorId,
              },
              principal,
              now,
            );
            if (
              !definition.gate.some(
                (capability) =>
                  dependencies.authorize({ ...authority, capability }).allow,
              )
            )
              throw new CommandDenied('not-found');
            const ids = loaded.ratingConfigurations.flatMap((configuration) => {
              const id =
                eventSettingResolution(configuration).settings[
                  'standings.rating_ladder'
                ].value.ladderId;
              return id ? [id] : [];
            });
            const inputs = await session.ratingInputs(ids);
            loaded.ratingSnapshot = freezeTournamentRatings(
              loaded.ratingConfigurations,
              inputs,
              now,
            );
          }
          const target =
            command.type === 'generate-draw'
              ? null
              : loaded.versions.find(
                  (row) =>
                    row.id ===
                    (command.type === 'edit-draw'
                      ? command.basedOnDrawId
                      : command.drawId),
                );
          return runLobbyCommand<
            DrawCommand,
            LoadedDrawCommand,
            string,
            DrawWrite
          >(
            {
              authorize: dependencies.authorize,
              digest: commandDigest,
              now: () => now,
              transaction: (work) =>
                work({
                  stored: session.stored,
                  facts: async () => loaded,
                  authority: (facts) =>
                    drawAuthority(
                      {
                        lobby: facts.configuration.lobby,
                        authorization: facts.authorization,
                        ownerActorId: facts.ownerActorId,
                      },
                      principal,
                      now,
                    ),
                  versions: (facts) => ({
                    draw: facts.versions
                      .filter((row) => row.tabRoundId === facts.round.id)
                      .reduce<number | undefined>(
                        (best, row) =>
                          best === undefined
                            ? row.version
                            : Math.max(best, row.version),
                        undefined,
                      ),
                    entries: facts.configuration.event.entriesVersion,
                    settings: facts.configuration.event.settingsVersion,
                    results: eventResultsVersion(facts),
                    timeSlot: facts.slot?.version,
                  }),
                  scope: (facts) => ({
                    kind: 'lobby',
                    lobbyId: facts.configuration.lobby.id,
                  }),
                  recordConflict: neverHeld,
                  holdForConfirmation: neverHeld,
                  apply: (writes, history, receipt) =>
                    session.apply(writes, history, receipt, {
                      ...(command.type === 'generate-draw' &&
                      loaded.ratingSnapshot
                        ? { ratingSnapshot: loaded.ratingSnapshot }
                        : {}),
                      ...(command.type === 'publish-draw'
                        ? eventRoomAssemblies(
                            loaded,
                            drawFacts(
                              loaded,
                              dependencies.competition(loaded, command),
                              {
                                commandId: parsed.data.commandId,
                                now,
                                newId: dependencies.newId,
                              },
                            ),
                            writes,
                            principal,
                            publicationEntropy,
                            dependencies.newId,
                          )
                        : { rooms: [], resolutionPin: null }),
                      notificationIds: dependencies.newId,
                      closeRoom,
                      activeRoomMembers,
                    }),
                }),
            },
            { ...parsed.data, command },
            drawCommandDefinition(command.type, target?.status ?? 'draft'),
            (facts, requested) => {
              // Running windowed stages belongs to its separate unreleased layer.
              if (
                requested.type === 'publish-draw' &&
                facts.stage?.timing !== 'live'
              )
                throw new CommandDenied('not-found');
              if (
                requested.type === 'assign-judges' &&
                target?.status !== 'draft'
              )
                throw new CommandDenied('not-found');
              if (facts.configuration.lobby.closedAt !== null)
                return { kind: 'refused', refusal: 'lobby-closed' };
              const mapped = drawFacts(
                facts,
                dependencies.competition(facts, command),
                {
                  commandId: parsed.data.commandId,
                  now,
                  newId: dependencies.newId,
                },
              );
              const decision = decideDraw(tabEngine)(mapped, requested);
              if (
                decision.kind === 'accepted' &&
                requested.type === 'publish-draw' &&
                mapped.settings.kind === 'resolved'
              ) {
                const current = mapped.versions.find(
                  (draw) => draw.id === requested.drawId,
                );
                if (
                  current &&
                  mapped.fixtures.some(
                    (fixture) =>
                      current.fixtureIds.includes(fixture.id) &&
                      fixture.status === 'draft' &&
                      fixture.kind !== 'bye' &&
                      !eventRoomPins(facts, publicationEntropy, fixture, now),
                  )
                )
                  return { kind: 'refused', refusal: 'draw-unresolved' };
              }
              if (
                decision.kind === 'accepted' &&
                !drawAdmissionsAllowed(facts, decision.writes)
              )
                throw new CommandDenied('not-found');
              return decision;
            },
          );
        },
      );
    } catch (error) {
      if (
        error instanceof EventSettingParentsChanged ||
        error instanceof DrawPeopleChanged
      )
        return { kind: 'refused', refusal: 'version-conflict' };
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };
