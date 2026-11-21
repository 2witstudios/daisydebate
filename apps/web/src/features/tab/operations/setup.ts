import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  type TabStore,
  type LoadedSetupCommand,
  type SetupWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import {
  lobbySetupCommandCatalogue,
  lobbySetupCommandEnvelopeSchema,
  type TournamentSetupCommand,
} from '@daisy/protocol/lobby/lobby-setup-command';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import type { TabPrincipal } from '../tab-principal';
import { decideSetup } from '../commands/setup';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import { commandDigest } from '@daisy/digest';
import { setupFacts } from './setup-facts';
import { hostLobbyResource } from './host-lobby-resource';

type Dependencies = {
  readonly store: Pick<TabStore, 'setupCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly newId: () => string;
};
const isSetup = (command: {
  readonly type: string;
}): command is TournamentSetupCommand =>
  [
    'add-event',
    'update-event',
    'remove-event',
    'add-stage',
    'update-stage',
    'add-tab-round',
    'update-tab-round',
    'add-time-slot',
    'update-time-slot',
    'remove-time-slot',
    'place-tab-round',
    'define-ballot',
    'add-resolution',
    'retire-resolution',
  ].includes(command.type);
const neverHeld = (): never => {
  throw createAppError('INVARIANT', 'Setup has no fixture conflict');
};
export const setupCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    body: unknown,
  ): Promise<LobbyCommandAnswer<string>> => {
    const parsed = lobbySetupCommandEnvelopeSchema.safeParse(body);
    if (!parsed.success || !isSetup(parsed.data.command))
      throw createAppError('VALIDATION');
    const command = parsed.data.command;
    const envelope = { ...parsed.data, command };
    let now = dependencies.now();
    const newIds = {
      primary: dependencies.newId(),
      secondary: dependencies.newId(),
    };
    try {
      return await runLobbyCommand<
        TournamentSetupCommand,
        LoadedSetupCommand,
        string,
        SetupWrite
      >(
        {
          authorize: dependencies.authorize,
          digest: commandDigest,
          now: () => now,
          transaction: (work) =>
            dependencies.store.setupCommand(
              { senderUserId: principal.userId, command, now, newIds },
              (session) =>
                work({
                  stored: session.stored,
                  facts: async () => {
                    const loaded = await session.load();
                    now = dependencies.now();
                    return loaded;
                  },
                  authority: (loaded) => ({
                    principal,
                    resource: hostLobbyResource(
                      loaded.lobby,
                      loaded.authorization.organization,
                      loaded.ownerActorId,
                    ),
                    context: {
                      account: loaded.authorization.account,
                      grants: loaded.authorization.grants,
                      now,
                    },
                  }),
                  versions: ({ lobby, slots }) => ({
                    ...(lobby ? { lobby: lobby.version } : {}),
                    timeSlot:
                      command.type === 'update-time-slot' ||
                      command.type === 'remove-time-slot'
                        ? slots.find((slot) => slot.id === command.timeSlotId)
                            ?.version
                        : undefined,
                  }),
                  scope: ({ lobby }) => {
                    if (!lobby) throw new CommandDenied('not-found');
                    return { kind: 'lobby', lobbyId: lobby.id };
                  },
                  recordConflict: neverHeld,
                  holdForConfirmation: neverHeld,
                  apply: session.apply,
                }),
            ),
        },
        envelope,
        lobbySetupCommandCatalogue[command.type],
        (loaded, requested) =>
          decideSetup(setupFacts(loaded, { now, newIds }), requested),
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };
