import type { RoomAssemblyState } from '@daisy/protocol';
type Seat = RoomAssemblyState['participants'][number];
const sameAudience = (previous: Seat, next: Seat) =>
  previous.actorId === next.actorId;
/** A content/readiness change cannot manufacture a membership removal or a privacy purge. */
export function reconcileRoomParticipants(
  previous: readonly Seat[],
  next: readonly Seat[],
) {
  const before = new Map(previous.map((p) => [p.id, p]));
  const after = new Map(next.map((p) => [p.id, p]));
  const removeIds = previous
    .filter((p) => !after.has(p.id) || !sameAudience(p, after.get(p.id)!))
    .map((p) => p.id)
    .sort();
  const insertSeats = next
    .filter((p) => !before.has(p.id) || !sameAudience(before.get(p.id)!, p))
    .sort((a, b) => a.id.localeCompare(b.id));
  const updatedSeats = next
    .filter((p) => {
      const old = before.get(p.id);
      return (
        old &&
        sameAudience(old, p) &&
        (old.consentCommandId !== p.consentCommandId ||
          old.consentVersion !== p.consentVersion ||
          old.role !== p.role ||
          old.slot !== p.slot)
      );
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return { removeIds, insertSeats, updatedSeats };
}
