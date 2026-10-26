import type { RoomView } from '@daisy/protocol';

/** One idempotency key per room form, so a replayed post is recognized. */
export type RoomCommandIds = {
  readonly header: {
    readonly details: string;
    readonly leave: string;
    readonly close: string;
  };
  readonly readiness: {
    readonly ready: string;
    readonly unready: string;
    readonly 'start-round': string;
  };
  readonly prep: { readonly start: string; readonly finish: string };
  readonly settings: string;
  /** Per declared seat, in `declaredSeats` order. */
  readonly seats: readonly {
    readonly claim: string;
    readonly assign: string;
    readonly remove: string;
    readonly ai: string;
  }[];
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
  const header = { details: nextId(), leave: nextId(), close: nextId() };
  const readiness = {
    ready: nextId(),
    unready: nextId(),
    'start-round': nextId(),
  };
  const prep = { start: nextId(), finish: nextId() };
  const settings = nextId();
  const { affirmative, negative, judge } = view.definition.seats;
  const seats = Array.from({ length: affirmative + negative + judge }, () => ({
    claim: nextId(),
    assign: nextId(),
    remove: nextId(),
    ai: nextId(),
  }));
  return { header, readiness, prep, settings, seats };
}
