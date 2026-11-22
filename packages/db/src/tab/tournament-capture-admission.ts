import { createAppError, createRefusal } from '@daisy/errors';
import {
  tournamentCaptureAdmissionSchema,
  type TournamentCaptureAdmission,
} from '@daisy/protocol/tournament-capture-admission';
import { tournamentCaptureAdmissions } from '../schema/tournament-capture-admissions';
import {
  NONRANKED_CAPTURE_FLEET_LIMIT,
  readNonrankedCaptureCapacity,
} from '../nonranked-capture-capacity';
import type { RoomDirectionInput } from './room-direction';
import type { Tx } from '../tx';

/** The admission names exactly the grant or paid purchase its funder holds now. */
const basisHeld = (
  admission: TournamentCaptureAdmission,
  funding: NonNullable<RoomDirectionInput['funding']>,
) => {
  const { basis } = admission;
  switch (basis.kind) {
    case 'grant':
      return (
        basis.grant.hosting.userId === funding.userId &&
        funding.hosting.grants.some(
          (grant) => JSON.stringify(grant) === JSON.stringify(basis.grant),
        )
      );
    case 'hosting-purchase':
      return (
        funding.ownerUserId === funding.userId &&
        JSON.stringify(funding.hostingPurchase) ===
          JSON.stringify(basis.purchase)
      );
  }
};

/** Called after the named Round/receipt insert under the already held physical-capacity lock. */
export const reserveTournamentCapture = async (
  tx: Tx,
  input: {
    readonly admission: TournamentCaptureAdmission;
    readonly direction: RoomDirectionInput;
    readonly roundId: string;
    readonly roomId: string;
    readonly commandId: string;
    readonly actorId: string;
  },
) => {
  const admission = tournamentCaptureAdmissionSchema.parse(input.admission),
    funding = input.direction.funding;
  if (
    !funding ||
    admission.roundId !== input.roundId ||
    admission.roomId !== input.roomId ||
    admission.commandId !== input.commandId ||
    admission.official.actorId !== input.actorId ||
    admission.fixtureId !== input.direction.fixtureId ||
    admission.lobbyId !== funding.lobbyId ||
    !basisHeld(admission, funding)
  )
    throw createAppError(
      'INVARIANT',
      'Capture admission must name its current locked source',
    );
  const counts = await readNonrankedCaptureCapacity(tx, {
    roundId: input.roundId,
    hostActorId: null,
    sponsorUserId: funding.userId,
    lobbyId: funding.lobbyId,
  });
  if (counts.sponsored >= admission.capacity.sponsorLimit)
    throw createRefusal('CONFLICT', 'capture-host-limit');
  if (
    counts.tournament >= admission.capacity.tournamentLimit ||
    counts.running >= NONRANKED_CAPTURE_FLEET_LIMIT
  )
    throw createRefusal('CONFLICT', 'capture-capacity');
  await tx.insert(tournamentCaptureAdmissions).values({
    id: admission.id,
    roundId: admission.roundId,
    roomId: admission.roomId,
    lobbyId: admission.lobbyId,
    fixtureId: admission.fixtureId,
    sponsorUserId: funding.userId,
    hostingVersionId:
      admission.basis.kind === 'grant'
        ? admission.basis.grant.hosting.id
        : null,
    hostingPurchaseId:
      admission.basis.kind === 'hosting-purchase'
        ? admission.basis.purchase.id
        : null,
    sponsorshipVersionId:
      admission.funding.kind === 'organization-sponsor'
        ? admission.funding.sponsorshipVersionId
        : null,
    officialUserId: admission.official.userId,
    officialActorId: admission.official.actorId,
    commandId: admission.commandId,
    admission,
    deadlineAt: new Date(admission.deadlineAt),
    createdAt: new Date(admission.admittedAt),
  });
};
