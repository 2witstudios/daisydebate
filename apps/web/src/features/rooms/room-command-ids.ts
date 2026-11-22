import { seatTotalOf } from '@daisy/protocol/format-seating';
import { type RoomView } from '@daisy/protocol/room-contract';

/** One idempotency key per room form, so a replayed post is recognized. */
export type RoomCommandIds = {
  readonly header: {
    readonly details: string;
    readonly close: string;
  };
  readonly readiness: {
    readonly ready: string;
    readonly unready: string;
    readonly 'start-round': string;
  };
  readonly settings: string;
  readonly capture: string;
  /** Team 1's side (ADR 0145). */
  readonly sides: string;
  /** Who can join, from the page's Room controls. */
  readonly visibility: string;
  /** The viewer's own Leave seat, on their roster row. */
  readonly leave: string;
  /** Per declared seat, in `declaredSeats` order. */
  readonly seats: readonly {
    readonly claim: string;
    readonly assign: string;
    readonly remove: string;
    readonly ai: string;
    /** The seated debater's team, and their position (ADR 0145). */
    readonly team: string;
    readonly position: string;
  }[];
  /** Choosing a standard, Back to the basis, and starting from a league template (FMT-3). */
  readonly format: {
    readonly choose: string;
    readonly reset: string;
    readonly template: string;
  };
};

/**
 * Every command identifier a room view's forms need. The server builds the
 * first set so hydration matches; the room sync driver builds a new set for
 * each newer view so an accepted command's key is never offered again.
 */
export function roomCommandIds(
  view: RoomView,
  nextId: () => string,
): RoomCommandIds {
  const header = { details: nextId(), close: nextId() };
  const readiness = {
    ready: nextId(),
    unready: nextId(),
    'start-round': nextId(),
  };
  const settings = nextId();
  const seats = Array.from({ length: seatTotalOf(view.rules) }, () => ({
    claim: nextId(),
    assign: nextId(),
    remove: nextId(),
    ai: nextId(),
    team: nextId(),
    position: nextId(),
  }));
  const format = { choose: nextId(), reset: nextId(), template: nextId() };
  const capture = nextId();
  const sides = nextId();
  const visibility = nextId();
  const leave = nextId();
  return {
    header,
    readiness,
    settings,
    capture,
    sides,
    visibility,
    leave,
    seats,
    format,
  };
}
