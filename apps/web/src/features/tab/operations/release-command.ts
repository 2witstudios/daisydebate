import type {
  AuthorizationInput,
  AuthorizationDecision,
} from '@daisy/auth/authorization';
import {
  CommandIdTaken,
  EventSettingParentsChanged,
  type TabStore,
  type LoadedReleaseCommand,
  type ReleaseCommandWrite,
} from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  releaseCommandEnvelopeSchema,
  releaseCommandCatalogue,
  type ReleaseCommandRefusal,
} from '@daisy/protocol/lobby/result-command';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import {
  decideOpenAudience,
  decideReleaseResolution,
} from '../commands/result';
import { hostLobbyResource } from './host-lobby-resource';
import { eventSettingResolution } from './event-setting-resolution';
import { commandDigest } from './command-digest';
import { orderedWordings } from './resolution-wording-order';
import type { TabPrincipal } from '../tab-principal';
const noFixtureConflict = (): never => {
  throw createAppError(
    'INVARIANT',
    'An event release is not a fixture command',
  );
};

/** Manual openings are facts; changing a setting never fabricates or retracts an opening. */
export const releaseCommand =
  (dependencies: {
    readonly store: Pick<TabStore, 'releaseCommand'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly newId: () => string;
  }) =>
  async (principal: TabPrincipal, lobbyId: string, body: unknown) => {
    const parsed = releaseCommandEnvelopeSchema.safeParse(body);
    if (!idSchema.safeParse(lobbyId).success || !parsed.success)
      throw createAppError('VALIDATION');
    const command = parsed.data.command;
    const entropy = dependencies.newId();
    try {
      return await dependencies.store.releaseCommand(
        {
          senderUserId: principal.userId,
          lobbyId,
          command,
          notificationIds: dependencies.newId,
        },
        async (session) => {
          const loaded = await session.load();
          if (!loaded) throw new CommandDenied('not-found');
          const resource = hostLobbyResource(
            loaded.configuration.lobby,
            loaded.authorization.organization,
            loaded.ownerActorId,
          );
          const authority = {
            principal,
            resource,
            context: {
              account: loaded.authorization.account,
              grants: loaded.authorization.grants,
              now: loaded.checkedAt,
            },
          };
          const definition = releaseCommandCatalogue[command.type];
          if (
            !definition.gate.some(
              (capability) =>
                dependencies.authorize({ ...authority, capability }).allow,
            )
          )
            throw new CommandDenied('not-found');
          return runLobbyCommand<
            typeof command,
            LoadedReleaseCommand,
            ReleaseCommandRefusal | 'not-found' | 'lobby-closed',
            ReleaseCommandWrite
          >(
            {
              authorize: dependencies.authorize,
              digest: commandDigest,
              now: () => loaded.checkedAt,
              transaction: (work) =>
                work({
                  stored: session.stored,
                  facts: async () => loaded,
                  authority: () => authority,
                  versions: () => ({}),
                  scope: () => ({ kind: 'lobby', lobbyId }),
                  recordConflict: noFixtureConflict,
                  holdForConfirmation: noFixtureConflict,
                  apply: session.apply,
                }),
            },
            parsed.data,
            definition,
            (facts, requested) => {
              if (facts.configuration.lobby.closedAt !== null)
                return { kind: 'refused', refusal: 'lobby-closed' };
              const settings = eventSettingResolution(
                facts.configuration,
              ).settings;
              if (requested.type === 'open-audience')
                return decideOpenAudience(
                  {
                    commandId: parsed.data.commandId,
                    now: facts.checkedAt,
                    event: facts.configuration.event,
                    tabRounds: facts.rounds.map((row) => ({
                      id: row.id,
                      mintedReleaseId: dependencies.newId(),
                    })),
                    whens: settings[`audience.${requested.thing}`].value,
                    releases: facts.releases,
                    screenings: facts.screenings.map((row) => ({
                      ...row,
                      status: row.status ?? 'pending',
                    })),
                  },
                  requested,
                );
              if (!facts.target)
                return { kind: 'refused', refusal: 'not-found' };
              const live =
                facts.resolutionPool?.resolutions.filter(
                  (row) => row.retiredAt === null,
                ) ?? [];
              return decideReleaseResolution(
                {
                  now: facts.checkedAt,
                  tabRound: {
                    ...facts.target,
                    resolutionReleasedAt:
                      facts.target.resolutionReleasedAt?.toISOString() ?? null,
                  },
                  rule: settings['resolution.rule'].value,
                  drawnPoolResolutionId:
                    orderedWordings(live, entropy, facts.target.id)[0]?.id ??
                    null,
                },
                requested,
              );
            },
          );
        },
      );
    } catch (error) {
      if (error instanceof CommandIdTaken)
        return {
          kind: 'refused' as const,
          refusal: 'command-conflict' as const,
        };
      if (error instanceof EventSettingParentsChanged)
        throw createAppError('CONFLICT', 'Event settings changed');
      throw error;
    }
  };
