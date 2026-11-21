import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  type TabStore,
  type LobbyAdministrationCommand,
  type LobbyAdministrationFacts,
  type LobbyAdministrationWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import {
  lobbySetupCommandCatalogue,
  lobbySetupCommandEnvelopeSchema,
} from '@daisy/protocol/lobby/lobby-setup-command';
import type { LobbyCommandAnswer } from '@daisy/protocol/lobby/command';
import type { TabPrincipal } from '../tab-principal';
import { decideLobby, type LobbyFacts } from '../commands/lobby';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import { commandDigest } from './command-digest';
import { lobbyAdministrationAuthority } from './lobby-administration-authority';

type Dependencies = {
  readonly store: Pick<TabStore, 'lobbyAdministrationCommand'>;
  readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
  readonly now: () => string;
  readonly newId: () => string;
};
const neverHeld = (): never => {
  throw createAppError(
    'INVARIANT',
    'Lobby administration has no fixture conflict',
  );
};

const decisionFacts = (
  loaded: LobbyAdministrationFacts,
  input: {
    readonly principal: TabPrincipal;
    readonly now: string;
    readonly newId: string;
  },
): LobbyFacts => {
  const { lobby, organization } = loaded;
  const common =
    lobby === null
      ? null
      : {
          id: lobby.id,
          ownerOrganizationId: lobby.ownerOrganizationId,
          closedAt: lobby.closedAt,
          version: lobby.version,
        };
  return {
    now: input.now,
    newId: input.newId,
    actorUserId: input.principal.userId,
    handleTaken: loaded.handleTaken,
    organization:
      organization.organization === null
        ? null
        : {
            id: organization.organization.organizationId,
            kind: organization.organization.organizationKind,
          },
    lobby:
      lobby === null || common === null
        ? null
        : lobby.kind === 'standing'
          ? {
              ...common,
              kind: 'standing',
              ownerOrganizationId: lobby.ownerOrganizationId!,
            }
          : {
              ...common,
              kind: 'tournament',
              status: lobby.status,
              admitsMinors: lobby.admitsMinors,
            },
    activeSeasonId: loaded.activeSeasonId,
    season: loaded.season,
    ladder: loaded.ladder,
    activity: loaded.activity,
    // Room creation is a separate operation; these facts are not consumed by administration.
    room: {
      offeredTemplates: [],
      ownFormat: 'off',
      ownText: 'off',
      enforcedVisibility: null,
    },
  };
};

export const lobbyAdministrationCommand =
  (dependencies: Dependencies) =>
  async (
    principal: TabPrincipal,
    body: unknown,
  ): Promise<LobbyCommandAnswer<string>> => {
    const parsed = lobbySetupCommandEnvelopeSchema.safeParse(body);
    if (
      !parsed.success ||
      parsed.data.command.type === 'create-lobby-room' ||
      parsed.data.command.type === 'close-lobby' ||
      !isLobbyAdministration(parsed.data.command)
    )
      throw createAppError('VALIDATION');
    const command = parsed.data.command;
    const envelope = { ...parsed.data, command };
    let now = dependencies.now();
    const newId = dependencies.newId();
    try {
      return await runLobbyCommand<
        LobbyAdministrationCommand,
        LobbyAdministrationFacts,
        string,
        LobbyAdministrationWrite
      >(
        {
          authorize: dependencies.authorize,
          digest: commandDigest,
          now: () => now,
          transaction: (work) =>
            dependencies.store.lobbyAdministrationCommand(
              { senderUserId: principal.userId, command, newId, now },
              (session) =>
                work({
                  stored: session.stored,
                  facts: async () => {
                    const loaded = await session.load();
                    now = loaded.hosting.checkedAt;
                    return loaded;
                  },
                  authority: (facts) => {
                    const input = lobbyAdministrationAuthority(
                      principal,
                      command,
                      facts,
                      { now },
                    );
                    if (
                      command.type === 'create-lobby' &&
                      !lobbySetupCommandCatalogue[command.type].gate.some(
                        (capability) =>
                          dependencies.authorize({ ...input, capability })
                            .allow,
                      )
                    )
                      throw new CommandDenied('not-found');
                    return input;
                  },
                  versions: (facts) => ({
                    ...(facts.lobby ? { lobby: facts.lobby.version } : {}),
                    ...(facts.season ? { season: facts.season.version } : {}),
                  }),
                  scope: (facts) => {
                    if (command.type === 'create-lobby')
                      return { kind: 'lobby', lobbyId: newId };
                    if (
                      command.type === 'update-lobby' ||
                      command.type === 'set-ladder' ||
                      command.type === 'save-ladder' ||
                      command.type === 'edit-standing-lobby' ||
                      command.type === 'set-tournament-status'
                    )
                      return { kind: 'lobby', lobbyId: command.lobbyId };
                    const organizationId =
                      facts.organization.organization?.organizationId;
                    if (!organizationId) throw new CommandDenied('not-found');
                    return { kind: 'organization', organizationId };
                  },
                  recordConflict: neverHeld,
                  holdForConfirmation: neverHeld,
                  apply: session.apply,
                }),
            ),
        },
        envelope,
        lobbySetupCommandCatalogue[command.type],
        (loaded, requested) => {
          const decision = decideLobby(
            decisionFacts(loaded, { principal, now, newId }),
            requested,
          );
          if (decision.kind === 'refused') return decision;
          const writes = decision.writes.map(
            (write): LobbyAdministrationWrite => {
              if (write.table === 'rooms')
                throw createAppError(
                  'INVARIANT',
                  'Administration cannot assemble or close a Room',
                );
              return write;
            },
          );
          return { ...decision, writes };
        },
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return { kind: 'refused', refusal: 'command-conflict' };
      throw error;
    }
  };

export const isLobbyAdministration = (command: {
  readonly type: string;
}): command is LobbyAdministrationCommand =>
  [
    'create-lobby',
    'update-lobby',
    'set-tournament-status',
    'create-season',
    'close-season',
    'set-ladder',
    'save-ladder',
    'edit-season',
    'edit-standing-lobby',
  ].includes(command.type);
