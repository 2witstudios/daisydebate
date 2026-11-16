import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  EventSettingParentsChanged,
  FixturePeopleChanged,
  type TabStore,
  type LoadedResultCommand,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  resultCommandEnvelopeSchema,
  resultCommandCatalogue,
} from '@daisy/protocol/lobby/result-command';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import type { FixtureResultWrite } from '../commands/result';
import type { ResultCommandRefusal } from '@daisy/protocol/lobby/result-command';
import { decideFixtureResult } from '../commands/result';
import { hostLobbyResource } from './host-lobby-resource';
import { resultFacts } from './result-facts';
import { eventSettingResolution } from './event-setting-resolution';
import { commandDigest } from './command-digest';
import type { TabPrincipal } from '../tab-principal';

/** Guarded competitive result capture and complete replacement, never client-authored source provenance. */
export const resultCommand =
  (dependencies: {
    readonly store: Pick<TabStore, 'resultCommand'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: () => string;
    readonly newId: () => string;
    readonly confirmationExpiresAt: (now: string) => string;
  }) =>
  async (principal: TabPrincipal, lobbyId: string, body: unknown) => {
    const parsed = resultCommandEnvelopeSchema.safeParse(body);
    if (
      !idSchema.safeParse(lobbyId).success ||
      !parsed.success ||
      !('fixtureId' in parsed.data.command)
    )
      throw createAppError('VALIDATION');
    const command = parsed.data.command,
      definition = resultCommandCatalogue[command.type],
      resultId = dependencies.newId();
    try {
      return await dependencies.store.resultCommand(
        { lobbyId, senderUserId: principal.userId, command },
        async (session) => {
          const loaded = await session.load();
          if (!loaded) throw new CommandDenied('not-found');
          const now = loaded.checkedAt;
          const lobby = hostLobbyResource(
            loaded.configuration.lobby,
            loaded.authorization.organization,
            loaded.ownerActorId,
          );
          if (lobby.kind !== 'lobby' || lobby.scope.lobbyKind !== 'tournament')
            throw new CommandDenied('not-found');
          const authority = {
            principal,
            resource: {
              kind: 'fixture' as const,
              fixtureId: loaded.fixture.id,
              scope: lobby.scope,
              conflict: {
                connections: loaded.connections,
                handling: eventSettingResolution(loaded.configuration).settings[
                  'conflict.handling'
                ].value.value,
                waiverId: null,
              },
              viewing: { audiences: [], releases: [] },
            },
            context: {
              account: loaded.authorization.account,
              grants: loaded.authorization.grants,
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
            LoadedResultCommand,
            ResultCommandRefusal | 'not-found',
            FixtureResultWrite
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
                  versions: () => ({ fixture: loaded.fixture.version }),
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
                  apply: session.apply,
                }),
            },
            { ...parsed.data, command },
            definition,
            (facts, requested) =>
              decideFixtureResult(
                resultFacts(facts, {
                  now,
                  commandId: parsed.data.commandId,
                  resultId,
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
