import {
  seatCountFor,
  type FormatSeating,
} from '@daisy/protocol/format-seating';
import {
  seatLabel,
  type SeatRef,
  type Side,
  type SideKey,
} from '@daisy/protocol/seats';

/**
 * How people read a format's sides and seats (TAB-6.17): always from the
 * format's own declared sides, never from a side key spelled here. The room,
 * the live Round, the ballot, the receipt and the watch cards share it.
 */

/** A format's seating with its sides' labels: a definition or compiled rules. */
export type NamedSeating = FormatSeating & { readonly sides: readonly Side[] };

const sideOf = (sides: readonly Side[], key: SideKey): Side | undefined =>
  sides.find((side) => side.key === key);

/** "Affirmative": a side's full name; an undeclared key reads as itself. */
export const sideName = (sides: readonly Side[], key: SideKey): string =>
  sideOf(sides, key)?.label ?? key;

/** "Aff": a side's short name, for tight columns and codes. */
export const sideShortName = (sides: readonly Side[], key: SideKey): string =>
  sideOf(sides, key)?.short ?? key;

/** "Affirmative", "Affirmative 2", "Judge", "Speaker 3": one seat by name. */
export const seatName = (seating: NamedSeating, seat: SeatRef): string =>
  seatLabel(seating.sides, seat, seatCountFor(seating, seat));

/** "1v1", "2v2", "2v2v2v2": debaters per side; an unsided format counts its speakers. */
export const shapeLabel = (seating: FormatSeating): string =>
  seating.sides.length > 0
    ? seating.sides
        .map((side) => String(seating.seats.sides[side.key] ?? 0))
        .join('v')
    : `${seating.seats.speakers} speakers`;
