import { sha3Hex } from '@daisy/digest';
import {
  isDebatingSeat,
  sameSeat,
  seatKey,
  seatOrder,
  sideOfSeat,
  type SeatRef,
  type Side,
} from '@daisy/protocol/seats';
import { isRoundOver, type RoundStatus } from '@daisy/protocol/round';
import { type FormatSeating } from '@daisy/protocol/format-seating';
import { seatName, sideName } from '../debate-room/seat-names';

/** A CSPRNG secret for one Egress's stage page; only its hash is ever stored. */
export const credentialHash = (secret: string) => sha3Hex(secret);

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
  readonly prep:
    | { readonly phase: 'called'; readonly side: string }
    | {
        readonly phase: 'running';
        readonly side: string;
        readonly remainingMs: number;
      }
    | null;
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
    /** The seat the segment is scheduled to; null for an open floor. */
    readonly lead: SeatRef | null;
  } | null;
  /** An accepted point of information's holder shares the floor while it lasts. */
  readonly pointOfInformation: {
    readonly holder: { readonly participantId: string } | null;
  } | null;
};

type StageSeat = {
  readonly seat: SeatRef;
  readonly label: string;
  readonly kind: 'human' | 'bot';
  /** Null until this seat has joined media: its name still belongs on the stage. */
  readonly identity: string | null;
  readonly participantId: string;
};

/** The format's sides and seats, so the stage reads them by their own names. */
type StageSeating = FormatSeating & { readonly sides: readonly Side[] };

/**
 * One seat on the frame, in its column: a side (in declared order) for a sided
 * format, or the seat itself for an unsided one.
 */
export type StageSeatView = {
  /** The column's stable key: the side's, or the seat's. */
  readonly column: string;
  /** How the column reads: the side's name, or the seat's. */
  readonly columnLabel: string;
  readonly label: string;
  readonly kind: 'human' | 'bot';
  readonly identity: string | null;
  readonly floor: boolean;
};

const columnOf = (seating: StageSeating, seat: SeatRef) => {
  const side = sideOfSeat(seat);
  return side === null
    ? { column: seatKey(seat), columnLabel: seatName(seating, seat) }
    : { column: side, columnLabel: sideName(seating.sides, side) };
};

/**
 * Whether a seat holds the floor: the segment's lead seat, every seat of its
 * side for a sided lead, and the seat giving an accepted point of information.
 */
const onFloor = (
  open: StagePosition['openSegment'],
  point: StagePosition['pointOfInformation'],
  seat: StageSeat,
): boolean => {
  if (open === null) return false;
  if (point?.holder?.participantId === seat.participantId) return true;
  if (open.lead === null) return false;
  const side = sideOfSeat(open.lead);
  return side === null
    ? sameSeat(open.lead, seat.seat)
    : side === sideOfSeat(seat.seat);
};

/**
 * What one phase of the stage can show, and nothing it cannot: only a speech has a
 * labelled clock, only a wait has time left, and only the wait between speeches knows
 * what comes next. A Round that is over is `ended`, never the `slate` before it began.
 */
type StagePhaseView =
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
  // Asked first, so a Round that is over reads as ended whatever else its position holds.
  if (isRoundOver(position.status)) return { phase: 'ended' };
  if (position.prep?.phase === 'running')
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
  readonly seating: StageSeating;
  readonly seats: readonly StageSeat[];
}): StageSnapshot & { readonly debaterIdentities: readonly string[] } => {
  const order = seatOrder(input.seating.sides);
  const debaters = input.seats
    .filter((seat) => isDebatingSeat(seat.seat))
    .sort(
      (a, b) =>
        order(a.seat, b.seat) || a.participantId.localeCompare(b.participantId),
    );
  return {
    ...phaseViewOf(input.position),
    seats: debaters.map((seat) => ({
      ...columnOf(input.seating, seat.seat),
      label: seat.label,
      kind: seat.kind,
      identity: seat.identity,
      floor: onFloor(
        input.position.openSegment,
        input.position.pointOfInformation,
        seat,
      ),
    })),
    debaterIdentities: debaters.flatMap((seat) =>
      seat.identity === null ? [] : [seat.identity],
    ),
  };
};
