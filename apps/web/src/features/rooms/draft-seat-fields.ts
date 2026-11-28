import { leadSeatOf, type SpeakRights } from '@daisy/protocol/format-seating';
import { sameSeat, type SeatRef } from '@daisy/protocol/seats';
import { type FormatDefinition } from '@daisy/protocol/format';

/**
 * The create-room editor's seat fields (TAB-6.17): one count per declared
 * side, then the unsided speakers, the judges and the moderator. A segment
 * names the seat it is scheduled to by a side key, `speaker` for an unsided
 * speaker, or nothing for an open floor, plus the seat's slot.
 */

type Segment = FormatDefinition['segments'][number];

/** The seat-count field for one declared side. */
export const sideSeatField = (side: string) => `seat.side.${side}`;
export const speakerSeatField = 'seat.speakers';
export const judgeSeatField = 'seat.judges';
export const moderatorSeatField = 'seat.moderators';
/** A segment's seat field value for an unsided speaker's seat. */
export const speakerSeatValue = 'speaker';

/** The editor's seat-count values for a definition. */
export const seatFieldValues = (
  definition: Pick<FormatDefinition, 'sides' | 'seats'>,
): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    definition.sides.map((side) => [
      sideSeatField(side.key),
      String(definition.seats.sides[side.key] ?? 0),
    ]),
  ),
  [speakerSeatField]: String(definition.seats.speakers),
  [judgeSeatField]: String(definition.seats.judges),
  [moderatorSeatField]: String(definition.seats.moderators),
});

/** The seats the fields name, over the format's declared sides; the schema judges them. */
export const seatsFromFields = (
  fields: Readonly<Record<string, string | undefined>>,
  sides: FormatDefinition['sides'],
) => ({
  sides: Object.fromEntries(
    sides.map((side) => [side.key, Number(fields[sideSeatField(side.key)])]),
  ),
  speakers: Number(fields[speakerSeatField]),
  judges: Number(fields[judgeSeatField]),
  moderators: Number(fields[moderatorSeatField]),
});

/** A segment's seat as two fields: the side key (or `speaker`, or empty) and the slot. */
export const segmentSeatValues = (
  speak: SpeakRights,
): { readonly side: string; readonly slot: string } => {
  const lead = leadSeatOf(speak);
  if (lead === null) return { side: '', slot: '0' };
  switch (lead.kind) {
    case 'side':
      return { side: lead.side, slot: String(lead.slot) };
    case 'speaker':
      return { side: speakerSeatValue, slot: String(lead.slot) };
    case 'judge':
    case 'moderator':
      return { side: lead.kind, slot: String(lead.slot) };
  }
};

const seatOfField = (side: string, slot: number): SeatRef | null => {
  if (side === '') return null;
  if (side === speakerSeatValue) return { kind: 'speaker', slot };
  if (side === 'moderator') return { kind: 'moderator', slot };
  return { kind: 'side', side, slot };
};

/**
 * Who may hold the floor in an edited segment. A segment that kept its
 * format's type and seat keeps the format's own speak rights; otherwise a
 * speech is its seat's alone, and a question period or an open floor is
 * everyone's, scheduled to its seat.
 */
export const speakFromFields = (
  fields: {
    readonly type: string;
    readonly side: string;
    readonly slot: number;
  },
  source: Segment | undefined,
): SpeakRights | null => {
  const lead = seatOfField(fields.side, fields.slot);
  const sourceLead = source ? leadSeatOf(source.speak) : null;
  if (
    source &&
    source.type === fields.type &&
    (lead === null
      ? sourceLead === null
      : sourceLead !== null && sameSeat(lead, sourceLead))
  )
    return source.speak;
  if (fields.type === 'speech')
    return lead === null ? null : { rights: 'one', seat: lead };
  // A cross-examination names who asks (INTX-10); an open floor may not.
  if (fields.type === 'cross_ex' && lead === null) return null;
  return { rights: 'all', lead };
};
