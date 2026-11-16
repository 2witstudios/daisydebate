import type {
  TournamentHostingGrant,
  TournamentSponsorshipVersion,
  TournamentSponsorshipChange,
} from '@daisy/protocol';
import type { TournamentSponsorshipCommand } from '@daisy/protocol/lobby/sponsorship-command';
import { tournamentHostingGrantFor } from '@daisy/auth/authorization';

export type TournamentSponsorshipFacts = {
  readonly now: string;
  readonly senderUserId: string;
  readonly newId: string;
  readonly lobby: {
    readonly id: string;
    readonly version: number;
    readonly ownerOrganizationId: string | null;
    readonly closedAt: string | null;
  };
  readonly current: TournamentSponsorshipVersion | null;
  readonly proposedAccountExists: boolean;
  readonly grants: readonly TournamentHostingGrant[];
};
export type TournamentSponsorshipWrite = {
  readonly sponsorship: TournamentSponsorshipChange;
  readonly lobbyVersion: number;
};

/** A proposal never charges its named account; only that account's exact acceptance selects funding. */
export const decideTournamentSponsorship = (
  facts: TournamentSponsorshipFacts,
  command: TournamentSponsorshipCommand,
) => {
  const unavailable = {
    kind: 'refused',
    refusal: 'sponsorship-unavailable',
  } as const;
  const { lobby, current } = facts;
  if (
    lobby.id !== command.lobbyId ||
    lobby.ownerOrganizationId === null ||
    lobby.closedAt !== null
  )
    return unavailable;
  const common = {
    id: facts.newId,
    lobbyId: lobby.id,
    version: (current?.version ?? 0) + 1,
    actedByUserId: facts.senderUserId,
    actedAt: facts.now,
  };
  const accepted = (sponsorship: TournamentSponsorshipChange) =>
    ({
      kind: 'accepted',
      aggregate: { kind: 'lobby', id: lobby.id },
      resultingVersion: lobby.version + 1,
      findings: [],
      fixtureChanges: [],
      writes: [{ sponsorship, lobbyVersion: lobby.version + 1 }],
    }) as const;
  switch (command.type) {
    case 'propose-tournament-sponsorship':
      if (!facts.proposedAccountExists) return unavailable;
      return accepted({
        ...common,
        kind: 'proposed',
        sponsorUserId: command.sponsorUserId,
        previousVersionId: current?.id ?? null,
      });
    case 'accept-tournament-sponsorship': {
      if (
        current?.kind !== 'proposed' ||
        current.id !== command.proposalId ||
        current.sponsorUserId !== facts.senderUserId
      )
        return unavailable;
      const grant = tournamentHostingGrantFor(facts.grants, {
        now: facts.now,
        userId: facts.senderUserId,
        tournamentId: lobby.id,
        versionId: command.hostingVersionId,
      });
      if (!grant)
        return {
          kind: 'refused',
          refusal: 'hosting-coverage-required',
        } as const;
      return accepted({
        ...common,
        kind: 'active',
        sponsorUserId: facts.senderUserId,
        previousVersionId: current.id,
        hostingVersionId: command.hostingVersionId,
      });
    }
    case 'revoke-tournament-sponsorship':
      if (!current || current.kind === 'revoked') return unavailable;
      return accepted({
        ...common,
        kind: 'revoked',
        sponsorUserId: current.sponsorUserId,
        previousVersionId: current.id,
        reason: command.reason,
      });
  }
};
