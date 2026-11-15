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
import { commandDigest } from './command-digest';
import { drawFacts, type DrawCompetition } from './draw-facts';
import { hostLobbyResource } from './host-lobby-resource';
import { tabEngine } from './tab-engine';
import { eventRoomPins } from './event-room-pins';
import { eventRoomAssemblies } from './event-room-assembly';
import { drawAdmissionsAllowed } from './draw-admission';

type Dependencies = {
  readonly store: Pick<TabStore, 'drawCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly competition: (facts: LoadedDrawCommand) => DrawCompetition;
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
                  authority: (facts) => {
                    const lobby = hostLobbyResource(
                      facts.configuration.lobby,
                      facts.authorization.organization,
                      facts.ownerActorId,
                    );
                    if (
                      lobby.kind !== 'lobby' ||
                      lobby.scope.lobbyKind !== 'tournament'
                    )
                      throw new CommandDenied('not-found');
                    return {
                      principal,
                      resource: {
                        kind: 'draw',
                        scope: lobby.scope,
                        viewing: { audiences: [], releases: [] },
                      },
                      context: {
                        account: facts.authorization.account,
                        grants: facts.authorization.grants,
                        now,
                      },
                    };
                  },
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
                    results: facts.results.length || undefined,
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
                      ...(command.type === 'publish-draw'
                        ? eventRoomAssemblies(
                            loaded,
                            drawFacts(
                              loaded,
                              dependencies.competition(loaded),
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
              const mapped = drawFacts(facts, dependencies.competition(facts), {
                commandId: parsed.data.commandId,
                now,
                newId: dependencies.newId,
              });
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
