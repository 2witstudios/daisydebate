import { CryptoHasher } from 'bun';

/** A CSPRNG secret for one Egress's stage page; only its hash is ever stored. */
export const credentialHash = (secret: string) =>
  new CryptoHasher('sha3-256').update(secret).digest('hex');

export const newStageCredential = (
  random: (bytes: number) => Uint8Array = (bytes) =>
    crypto.getRandomValues(new Uint8Array(bytes)),
) => {
  const secret = Buffer.from(random(32)).toString('base64url');
  return { secret, hash: credentialHash(secret) };
};

/** Compared as digests, so the comparison reveals nothing about the secret. */
export const stageCredentialValid = (
  secret: string | null,
  storedHash: string | null,
) =>
  secret !== null &&
  storedHash !== null &&
  credentialHash(secret) === storedHash;

/** The token follows revocation, so a stage reconnecting mid-prep gains nothing. */
export const observerAccess = (capture: {
  readonly observerRevokedAt: Date | null;
}) => ({ canSubscribe: capture.observerRevokedAt === null });

/** A human judge's identity, camera and voice never reach the stage. */
export const subscribesTo = (
  debaterIdentities: readonly string[],
  identity: string,
) => debaterIdentities.includes(identity);

type StagePosition = {
  readonly status: string;
  readonly stage: string | null;
  readonly prep: { readonly side: string } | null;
  readonly nextSegment: { readonly type: string } | null;
  readonly openSegment: {
    readonly label: string;
    readonly endsAt: string;
    readonly side: 'affirmative' | 'negative';
    readonly floorParticipantId: string | null;
  } | null;
};

type StageSeat = {
  readonly role: string;
  readonly label: string;
  readonly identity: string;
  readonly participantId: string;
};

const phaseOf = (position: StagePosition) => {
  if (position.prep) return 'prep' as const;
  if (position.stage === 'awaiting_ballot') return 'judging' as const;
  if (position.openSegment) return 'speech' as const;
  return position.status === 'active' && position.nextSegment
    ? ('between' as const)
    : ('slate' as const);
};

/** Everything the stage burns into the video; built field by field, judges excluded. */
export const stageSnapshot = (input: {
  readonly position: StagePosition;
  readonly seats: readonly StageSeat[];
}) => {
  const open = input.position.openSegment;
  const debaters = input.seats.filter(
    (seat) => seat.role === 'affirmative' || seat.role === 'negative',
  );
  return {
    phase: phaseOf(input.position),
    clock: open ? { label: open.label, endsAt: open.endsAt } : null,
    seats: debaters.map((seat) => ({
      side: seat.role as 'affirmative' | 'negative',
      label: seat.label,
      floor:
        open !== null &&
        (open.floorParticipantId
          ? open.floorParticipantId === seat.participantId
          : open.side === seat.role),
    })),
    debaterIdentities: debaters.map((seat) => seat.identity),
  };
};
