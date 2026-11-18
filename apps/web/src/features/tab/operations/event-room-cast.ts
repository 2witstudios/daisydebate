import {
  heldSeatsComplete,
  judgeSeat,
  sideSeat,
  type FormatDefinition,
  type SeatRef,
} from '@daisy/protocol';
import type { DrawFixtureFacts } from '../commands/draw';

/** The actual fixture must fill the immutable Room's ordinary seats exactly. */
export const eventRoomCast = (
  definition: FormatDefinition,
  fixture: DrawFixtureFacts,
): readonly { readonly actorId: string; readonly seat: SeatRef }[] | null => {
  const cast: { actorId: string; seat: SeatRef }[] = [];
  for (const entry of [...fixture.entries].sort(
    (a, b) => a.position - b.position,
  )) {
    for (const [slot, actorId] of entry.members.entries()) {
      const side = definition.sides[entry.position];
      if (fixture.kind !== 'section' && !side) return null;
      cast.push({
        actorId,
        seat:
          fixture.kind === 'section'
            ? { kind: 'speaker', slot: entry.position + slot }
            : sideSeat(side!.key, slot),
      });
    }
  }
  for (const [slot, judge] of [...fixture.judges]
    .sort((a, b) => Number(b.chair) - Number(a.chair))
    .entries())
    cast.push({ actorId: judge.person, seat: judgeSeat(slot) });
  return heldSeatsComplete(
    definition,
    cast.map((person) => person.seat),
  ) && new Set(cast.map((person) => person.actorId)).size === cast.length
    ? cast
    : null;
};
