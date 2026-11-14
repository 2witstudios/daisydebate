import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  type TabStore,
  type LoadedSettingCommand,
  type SettingWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import {
  settingCommandDefinition,
  settingCommandEnvelopeSchema,
  type SettingCommand,
} from '@daisy/protocol/lobby/setting-command';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import type { TabPrincipal } from '../tab-principal';
import { decideSetting } from '../commands/settings';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import { commandDigest } from './command-digest';
import { settingFacts } from './setting-facts';
import { settingAuthority } from './setting-authority';

type Dependencies = {
  readonly store: Pick<TabStore, 'settingCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly newId: () => string;
};
const neverHeld = (): never => {
  throw createAppError('INVARIANT', 'Settings have no fixture conflict');
};
export const settingCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    body: unknown,
  ): Promise<LobbyCommandAnswer<string>> => {
    const parsed = settingCommandEnvelopeSchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const envelope = parsed.data;
    const { command } = envelope;
    const now = dependencies.now();
    const newId = dependencies.newId();
    try {
      return await runLobbyCommand<
        SettingCommand,
        LoadedSettingCommand,
        string,
        SettingWrite
      >(
        {
          authorize: dependencies.authorize,
          digest: commandDigest,
          now: () => now,
          transaction: (work) =>
            dependencies.store.settingCommand(
              {
                senderUserId: principal.userId,
                command,
                newId,
                now,
                newSettingId: dependencies.newId,
              },
              (session) =>
                work({
                  stored: session.stored,
                  facts: session.load,
                  authority: (loaded) =>
                    settingAuthority(principal, command, loaded, now),
                  versions: (loaded) => {
                    const facts = settingFacts(loaded, command, { now, newId });
                    return {
                      ...(facts.scope
                        ? { settings: facts.scope.settingsVersion }
                        : {}),
                      ...(facts.template
                        ? { template: facts.template.version }
                        : {}),
                      ...(facts.lobby ? { lobby: facts.lobby.version } : {}),
                      ...(facts.event
                        ? {
                            event: facts.event.version,
                            settings: facts.event.settingsVersion,
                            entries: loaded.named.event!.entriesVersion,
                          }
                        : {}),
                    };
                  },
                  scope: ({ scope }) => {
                    if (scope.lobbyId)
                      return { kind: 'lobby', lobbyId: scope.lobbyId };
                    if (scope.organizationId)
                      return {
                        kind: 'organization',
                        organizationId: scope.organizationId,
                      };
                    throw new CommandDenied('not-found');
                  },
                  recordConflict: neverHeld,
                  holdForConfirmation: neverHeld,
                  apply: session.apply,
                }),
            ),
        },
        envelope,
        settingCommandDefinition(command),
        (loaded, requested) =>
          decideSetting(
            settingFacts(loaded, requested, { now, newId }),
            requested,
          ),
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };
