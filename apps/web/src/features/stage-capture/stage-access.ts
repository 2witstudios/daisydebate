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

type StagePosition = {
  readonly status: string;
  readonly stage: string | null;
  readonly prep: { readonly side: string; readonly remainingMs: number } | null;
  readonly nextSegment: {
    readonly type: string;
    readonly label: string;
  } | null;
  /** Time left before the next speech opens; null when no countdown runs. */
  readonly countdownRemainingMs: number | null;
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
  readonly kind: 'human' | 'bot';
  /** Null until this seat has joined media: its name still belongs on the stage. */
  readonly identity: string | null;
  readonly participantId: string;
};

/** Affirmative on the left, whatever order the seats were read in. */
const stageOrder = (a: StageSeat, b: StageSeat) =>
  a.role === b.role
    ? a.participantId.localeCompare(b.participantId)
    : a.role === 'affirmative'
      ? -1
      : 1;

export type StageSeatView = {
  readonly side: 'affirmative' | 'negative';
  readonly label: string;
  readonly kind: 'human' | 'bot';
  readonly identity: string | null;
  readonly floor: boolean;
};

/**
 * What one phase of the stage can show, and nothing it cannot: only a speech has a
 * labelled clock, only a wait with a deadline has an end, and only the wait between
 * speeches knows what comes next.
 */
export type StagePhaseView =
  | {
      readonly phase: 'speech';
      readonly clock: { readonly label: string; readonly endsAt: string };
    }
  | { readonly phase: 'prep'; readonly endsAt: string }
  | {
      readonly phase: 'between';
      readonly endsAt: string | null;
      readonly next: { readonly label: string };
    }
  | { readonly phase: 'judging' }
  | { readonly phase: 'slate' };

export type StageSnapshot = StagePhaseView & {
  readonly seats: readonly StageSeatView[];
};

const endsIn = (nowMs: number, remainingMs: number) =>
  new Date(nowMs + remainingMs).toISOString();

/**
 * A wait's end is the answer's own instant plus what is left, so a stopped clock reads
 * the same time on every answer instead of running down.
 */
const phaseViewOf = (
  position: StagePosition,
  nowMs: number,
): StagePhaseView => {
  if (position.prep)
    return { phase: 'prep', endsAt: endsIn(nowMs, position.prep.remainingMs) };
  if (position.stage === 'awaiting_ballot') return { phase: 'judging' };
  if (position.openSegment)
    return {
      phase: 'speech',
      clock: {
        label: position.openSegment.label,
        endsAt: position.openSegment.endsAt,
      },
    };
  if (position.status !== 'active' || !position.nextSegment)
    return { phase: 'slate' };
  return {
    phase: 'between',
    endsAt:
      position.countdownRemainingMs === null
        ? null
        : endsIn(nowMs, position.countdownRemainingMs),
    next: { label: position.nextSegment.label },
  };
};

/** Everything the stage burns into the video; built field by field, judges excluded. */
export const stageSnapshot = (input: {
  readonly position: StagePosition;
  readonly seats: readonly StageSeat[];
  /** The instant the position was read at. */
  readonly nowMs: number;
}): StageSnapshot & { readonly debaterIdentities: readonly string[] } => {
  const open = input.position.openSegment;
  const debaters = input.seats
    .filter((seat) => seat.role === 'affirmative' || seat.role === 'negative')
    .sort(stageOrder);
  return {
    ...phaseViewOf(input.position, input.nowMs),
    seats: debaters.map((seat) => ({
      side: seat.role as 'affirmative' | 'negative',
      label: seat.label,
      kind: seat.kind,
      identity: seat.identity,
      floor:
        open !== null &&
        (open.floorParticipantId
          ? open.floorParticipantId === seat.participantId
          : open.side === seat.role),
    })),
    debaterIdentities: debaters.flatMap((seat) =>
      seat.identity === null ? [] : [seat.identity],
    ),
  };
};
