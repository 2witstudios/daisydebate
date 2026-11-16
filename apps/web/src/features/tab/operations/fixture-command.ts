import {
  fixtureOwnerEffects,
  requireFixtureAdmissions,
} from './fixture-owner-effects';
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
import { fixtureAuthority } from './fixture-authority';
import { fixtureFacts } from './fixture-facts';

import { commandDigest } from './command-digest';
import type { TabPrincipal } from '../tab-principal';

/** Addressed officiating commands preserve ordinary owner lifecycle and immutable competitive provenance. */
export const fixtureCommand =
  (dependencies: {
    readonly store: Pick<TabStore, 'fixtureCommand'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: () => string;
    readonly newId: () => string;
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
          const authority = fixtureAuthority(competition, principal, now);
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
                    }),
                  apply: (writes, history, receipt) => {
                    requireFixtureAdmissions(loaded, command, writes);
                    return session.apply(
                      writes,
                      history,
                      receipt,
                      fixtureOwnerEffects(loaded, principal, {
                        command,
                        commandId: parsed.data.commandId,
                        payloadDigest: commandDigest({
                          expected: parsed.data.expected,
                          command,
                        }),
                        roomId,
                        newId: dependencies.newId,
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
                      }),
                    );
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
