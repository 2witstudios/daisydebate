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

type DraftCommand = Exclude<DrawCommand, { readonly type: 'publish-draw' }>;
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
    'Draft drawing is a fixture-less authority question',
  );
};
/** Draft versions and draft panels, under the actual account, parent, event and slot fences. */
export const drawDraftCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    lobbyId: string,
    body: unknown,
  ): Promise<LobbyCommandAnswer<string>> => {
    const parsed = drawCommandEnvelopeSchema.safeParse(body);
    if (
      !idSchema.safeParse(lobbyId).success ||
      !parsed.success ||
      parsed.data.command.type === 'publish-draw'
    )
      throw createAppError('VALIDATION');
    const command = parsed.data.command;
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
            DraftCommand,
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
                      rooms: [],
                      closeRoom,
                      activeRoomMembers,
                    }),
                }),
            },
            { ...parsed.data, command },
            drawCommandDefinition(command.type, target?.status ?? 'draft'),
            (facts, requested) => {
              if (
                requested.type === 'assign-judges' &&
                target?.status !== 'draft'
              )
                throw new CommandDenied('not-found');
              if (facts.configuration.lobby.closedAt !== null)
                return { kind: 'refused', refusal: 'lobby-closed' };
              if (
                facts.accounts.some(
                  ({ account }) =>
                    !account?.member ||
                    account.erased ||
                    account.ageBand !== 'adult' ||
                    account.boundary !== null,
                )
              )
                throw new CommandDenied('not-found');
              return decideDraw(tabEngine)(
                drawFacts(facts, dependencies.competition(facts), {
                  commandId: parsed.data.commandId,
                  now,
                  newId: dependencies.newId,
                }),
                requested,
              );
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
