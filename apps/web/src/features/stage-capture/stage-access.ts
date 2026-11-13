import { CryptoHasher } from 'bun';
import { isRoundOver, type RoundStatus } from '@daisy/protocol';

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
  readonly status: RoundStatus;
  readonly stage: string | null;
  readonly prep: { readonly side: string; readonly remainingMs: number } | null;
  readonly nextSegment: {
    readonly type: string;
    readonly label: string;
  } | null;
  /** Time left before the next speech opens: zero while its start is held. */
  readonly countdownRemainingMs: number | null;
  /** A platform incident stops every clock until its phase is `none`. */
  readonly incident: { readonly phase: string };
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
 * labelled clock, only a wait has time left, and only the wait between speeches knows
 * what comes next. A Round that is over is `ended`, never the `slate` before it began.
 */
export type StagePhaseView =
  | {
      readonly phase: 'speech';
      readonly clock: { readonly label: string; readonly endsAt: string };
    }
  | { readonly phase: 'prep'; readonly remainingMs: number | null }
  | {
      readonly phase: 'between';
      readonly remainingMs: number | null;
      readonly next: { readonly label: string };
    }
  | { readonly phase: 'judging' }
  | { readonly phase: 'slate' }
  | { readonly phase: 'ended' };

export type StageSnapshot = StagePhaseView & {
  readonly seats: readonly StageSeatView[];
};

/**
 * What is left of a wait, or null when nothing on the frame should count down: an
 * incident has stopped the clock, or the time is spent and the Round is held (a
 * speech's start waits for capture at zero), where a burned-in 0:00 would only look
 * stuck.
 */
const waitLeft = (position: StagePosition, remainingMs: number | null) =>
  position.incident.phase !== 'none' || remainingMs === null || remainingMs <= 0
    ? null
    : remainingMs;

const phaseViewOf = (position: StagePosition): StagePhaseView => {
  if (position.prep)
    return {
      phase: 'prep',
      remainingMs: waitLeft(position, position.prep.remainingMs),
    };
  if (position.stage === 'awaiting_ballot') return { phase: 'judging' };
  if (position.openSegment)
    return {
      phase: 'speech',
      clock: {
        label: position.openSegment.label,
        endsAt: position.openSegment.endsAt,
      },
    };
  if (isRoundOver(position.status)) return { phase: 'ended' };
  if (position.status !== 'active' || !position.nextSegment)
    return { phase: 'slate' };
  return {
    phase: 'between',
    remainingMs: waitLeft(position, position.countdownRemainingMs),
    next: { label: position.nextSegment.label },
  };
};

/** Everything the stage burns into the video; built field by field, judges excluded. */
export const stageSnapshot = (input: {
  readonly position: StagePosition;
  readonly seats: readonly StageSeat[];
}): StageSnapshot & { readonly debaterIdentities: readonly string[] } => {
  const open = input.position.openSegment;
  const debaters = input.seats
    .filter((seat) => seat.role === 'affirmative' || seat.role === 'negative')
    .sort(stageOrder);
  return {
    ...phaseViewOf(input.position),
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
