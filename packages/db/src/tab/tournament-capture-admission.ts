import { createAppError, createRefusal } from '@daisy/errors';
import {
  tournamentCaptureAdmissionSchema,
  type TournamentCaptureAdmission,
} from '@daisy/protocol';
import { tournamentCaptureAdmissions } from '../schema/tournament-capture-admissions';
import {
  NONRANKED_CAPTURE_FLEET_LIMIT,
  readNonrankedCaptureCapacity,
} from '../nonranked-capture-capacity';
import type { TabTransaction } from './tab-transaction';
import type { RoomDirectionInput } from './room-direction';

/** Called after the named Round/receipt insert under the already held physical-capacity lock. */
export const reserveTournamentCapture = async (
  tx: TabTransaction,
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
    admission.grant.hosting.userId !== funding.userId ||
    !funding.hosting.grants.some(
      (grant) => JSON.stringify(grant) === JSON.stringify(admission.grant),
    )
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
    sponsorUserId: admission.grant.hosting.userId,
    hostingVersionId: admission.grant.hosting.id,
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
