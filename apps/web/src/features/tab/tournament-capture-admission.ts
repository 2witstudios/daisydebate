import {
  participantAccess,
  tournamentHostingGrantFor,
} from '@daisy/auth/authorization';
import type { RoomDirectionInput } from '@daisy/db/tab';
import {
  tournamentCaptureAdmissionSchema,
  tournamentCaptureExecutionBudgetMs,
  type RoomAssemblyState,
  type TournamentOfficialAuthority,
} from '@daisy/protocol';
import { eventRoomDirectionDecision } from './event-room-direction';
import { hostingCaptureConcurrency } from '@daisy/protocol/lobby/hosting-tier';

/** Current acting authority and economic sponsorship are evaluated independently. */
export const eventCaptureAdmission = (input: {
  readonly caller: { readonly userId: string; readonly actorId: string };
  readonly room: RoomAssemblyState;
  readonly direction: RoomDirectionInput | null | undefined;
  readonly now: string;
  readonly admissionId: string;
  readonly roundId: string;
  readonly commandId: string;
}) => {
  const { direction, room, caller, now } = input;
  if (
    !direction?.funding ||
    room.hostActorId !== null ||
    room.capture?.recordingPolicy !== 'officials' ||
    room.capture.broadcast !== null
  )
    return null;
  const funding = direction.funding,
    account = funding.account;
  if (
    !account?.member ||
    account.erased ||
    account.restricted ||
    account.ageBand !== 'adult' ||
    !participantAccess(account) ||
    account.actorId !== funding.actorId
  )
    return null;
  const scope = direction.configuration.lobby;
  if (scope.id !== funding.lobbyId) return null;
  const sponsorship = funding.sponsorship;
  if (funding.ownerOrganizationId !== null && sponsorship?.kind !== 'active')
    return null;
  const grant = tournamentHostingGrantFor(funding.hosting.grants, {
    now,
    userId: funding.userId,
    tournamentId: scope.id,
    versionId:
      sponsorship?.kind === 'active' ? sponsorship.hostingVersionId : null,
  });
  // Without a grant, a personal tournament paid for funds its own capture (ADR 0149).
  const purchase =
    grant === null &&
    funding.ownerOrganizationId === null &&
    funding.ownerUserId === funding.userId
      ? funding.hostingPurchase
      : null;
  if (!grant && !purchase) return null;
  const decision = eventRoomDirectionDecision(
    caller,
    'room.manage',
    room,
    direction,
    now,
  );
  if (!decision?.allow) return null;
  let authority: TournamentOfficialAuthority;
  switch (decision.authority.kind) {
    case 'owner':
      authority = {
        kind: 'owner',
        scope:
          decision.authority.of.kind === 'organization'
            ? {
                kind: 'organization',
                organizationId: decision.authority.of.organizationId,
              }
            : { kind: 'lobby', lobbyId: decision.authority.of.lobbyId },
      };
      break;
    case 'grant': {
      const grantId = decision.authority.grantId;
      const actual = direction.authorization.grants.find(
        (g) => g.grantId === grantId,
      );
      if (!actual) return null;
      authority = {
        kind: 'grant',
        grantId: actual.grantId,
        revision: actual.revision,
        scope: actual.scope,
      };
      break;
    }
    case 'fixed':
    case 'relationship':
      return null;
  }
  const executionBudgetMs = tournamentCaptureExecutionBudgetMs(
    room.rules,
    room.executionPlan,
  );
  const deadline = Math.min(
    grant ? Date.parse(grant.hosting.expiresAt) : Infinity,
    Date.parse(now) + executionBudgetMs,
  );
  const limit = grant
    ? {
        sponsorLimit: grant.hosting.coverage.sponsorConcurrencyLimit,
        tournamentLimit: grant.hosting.coverage.tournamentConcurrencyLimit,
      }
    : {
        sponsorLimit: hostingCaptureConcurrency[purchase!.tier],
        tournamentLimit: hostingCaptureConcurrency[purchase!.tier],
      };
  if (
    !Number.isSafeInteger(executionBudgetMs) ||
    executionBudgetMs <= 0 ||
    !Number.isFinite(deadline) ||
    deadline <= Date.parse(now)
  )
    return null;
  const parsed = tournamentCaptureAdmissionSchema.safeParse({
    id: input.admissionId,
    roundId: input.roundId,
    roomId: room.id,
    lobbyId: scope.id,
    eventId: direction.configuration.event.id,
    fixtureId: direction.fixtureId,
    commandId: input.commandId,
    funding: funding.ownerUserId
      ? { kind: 'personal-owner', ownerUserId: funding.ownerUserId }
      : {
          kind: 'organization-sponsor',
          organizationId: funding.ownerOrganizationId,
          sponsorshipVersionId: sponsorship?.id,
        },
    basis: grant
      ? { kind: 'grant', grant }
      : { kind: 'hosting-purchase', purchase },
    official: { userId: caller.userId, actorId: caller.actorId, authority },
    admittedAt: now,
    deadlineAt: new Date(deadline).toISOString(),
    executionBudgetMs,
    capacity: {
      kind: 'nonranked-egress',
      fleetLimit: 1,
      ...limit,
    },
  });
  return parsed.success ? parsed.data : null;
};
