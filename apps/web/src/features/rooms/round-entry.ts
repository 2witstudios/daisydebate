import type { RoomView } from '@daisy/protocol';

/** Navigation reads only the signed-in member's seat in the authoritative Room. */
export function roundEntry(
  view: Pick<RoomView, 'participants' | 'roundRef'>,
  actorId: string,
  terminalRoundId: string | null,
) {
  const seated = view.participants.some(
    (seat) => 'actorId' in seat && seat.actorId === actorId,
  );
  const round = view.roundRef;
  if (!round) return { terminalRoundId, href: null };
  // Round status can change independently of the Room's changeVersion.
  const observedTerminal = ['completed', 'abandoned'].includes(round.status)
    ? round.id
    : terminalRoundId;
  const live = ['scheduled', 'active'].includes(round.status);
  return {
    terminalRoundId: observedTerminal,
    href:
      live && seated && round.id !== observedTerminal
        ? `/rounds/${round.id}/room`
        : null,
  };
}
