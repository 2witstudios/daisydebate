import {
  tournamentHostingGrantFor,
  type AuthorizationDecision,
  type AuthorizationInput,
} from '@daisy/auth/authorization';
import type { TabStore, LoadedTournamentSponsorship } from '@daisy/db/tab';
import { createAppError } from '@daisy/errors';
import {
  tournamentSponsorshipCommandCatalogue,
  tournamentSponsorshipCommandEnvelopeSchema,
  type TournamentSponsorshipCommand,
} from '@daisy/protocol/lobby/sponsorship-command';
import {
  decideTournamentSponsorship,
  type TournamentSponsorshipWrite,
} from '../commands/tournament-sponsorship';
import { CommandDenied, runLobbyCommand } from '../commands/run-command';
import type { TabPrincipal } from '../tab-principal';
import { commandDigest } from './command-digest';
import { hostLobbyResource } from './host-lobby-resource';

/** Current organization authority proposes; the actual funding account separately accepts or withdraws. */
export const tournamentSponsorshipCommand =
  (dependencies: {
    readonly store: Pick<TabStore, 'tournamentSponsorshipCommand'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly newId: () => string;
  }) =>
  async (principal: TabPrincipal, body: unknown) => {
    const parsed = tournamentSponsorshipCommandEnvelopeSchema.safeParse(body);
    if (!parsed.success) throw createAppError('VALIDATION');
    const envelope = parsed.data,
      command = envelope.command,
      definition = tournamentSponsorshipCommandCatalogue[command.type],
      newId = dependencies.newId();
    return dependencies.store.tournamentSponsorshipCommand(
      { senderUserId: principal.userId, command },
      async (session) => {
        const loaded = await session.load();
        if (!loaded || !loaded.authorization.organization)
          throw new CommandDenied('not-found');
        const host = hostLobbyResource(
          { ...loaded.lobby, kind: 'tournament' },
          loaded.authorization.organization,
          null,
        );
        if (host.kind !== 'lobby') throw new CommandDenied('not-found');
        const self =
          command.type === 'accept-tournament-sponsorship' ||
          (command.type === 'revoke-tournament-sponsorship' &&
            loaded.current?.sponsorUserId === principal.userId);
        const resource: AuthorizationInput['resource'] =
          self && loaded.sponsorActorId
            ? {
                kind: 'tournament_sponsorship',
                scope: { ...host.scope, lobbyKind: 'tournament' },
                sponsorActorId: loaded.sponsorActorId,
              }
            : host;
        const authority = {
          principal,
          resource,
          context: {
            account: loaded.authorization.account,
            grants: loaded.authorization.grants,
            now: loaded.now,
          },
        };
        if (
          !definition.gate.some(
            (capability) =>
              dependencies.authorize({ ...authority, capability }).allow,
          )
        )
          throw new CommandDenied('not-found');
        if (
          command.type === 'accept-tournament-sponsorship' &&
          !tournamentHostingGrantFor(loaded.hosting.grants, {
            now: loaded.now,
            userId: principal.userId,
            tournamentId: command.lobbyId,
            versionId: command.hostingVersionId,
          })
        )
          return {
            kind: 'refused',
            refusal: 'hosting-coverage-required',
          } as const;
        const neverHeld = (): never => {
          throw createAppError(
            'INVARIANT',
            'Sponsorship consent is not a fixture conflict',
          );
        };
        return runLobbyCommand<
          TournamentSponsorshipCommand,
          LoadedTournamentSponsorship,
          string,
          TournamentSponsorshipWrite
        >(
          {
            authorize: dependencies.authorize,
            digest: commandDigest,
            now: () => loaded.now,
            transaction: async (work) =>
              work({
                stored: session.stored,
                facts: async () => loaded,
                authority: () => authority,
                versions: () => ({ lobby: loaded.lobby.version }),
                scope: () => ({ kind: 'lobby', lobbyId: command.lobbyId }),
                recordConflict: neverHeld,
                holdForConfirmation: neverHeld,
                apply: session.apply,
              }),
          },
          envelope,
          definition,
          () =>
            decideTournamentSponsorship(
              {
                now: loaded.now,
                senderUserId: principal.userId,
                newId,
                lobby: loaded.lobby,
                current: loaded.current,
                proposedAccountExists: loaded.proposedAccountExists,
                grants: loaded.hosting.grants,
              },
              command,
            ),
        );
      },
    );
  };
