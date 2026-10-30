import type { RoomView } from '@daisy/protocol';

/** Round status changes independently of the Room's changeVersion. */
function observeRound(
  view: Pick<RoomView, 'id' | 'roundRef'>,
  terminal: Pick<RoomView, 'id' | 'roundRef'> | null,
) {
  const held = terminal?.id === view.id ? terminal.roundRef : null;
  const current = view.roundRef;
  const roundRef =
    held && (!current || current.id === held.id) ? held : current;
  if (!roundRef || !['completed', 'abandoned'].includes(roundRef.status))
    return { roundRef, terminal: null };
  return {
    roundRef,
    terminal: held === roundRef ? terminal : { id: view.id, roundRef },
  };
}

/** Entry and presentation share terminal knowledge; commands still use server authority. */
export function roundEntry(
  view: Pick<RoomView, 'id' | 'participants' | 'roundRef'>,
  actorId: string,
  terminal: Pick<RoomView, 'id' | 'roundRef'> | null,
) {
  const observed = observeRound(view, terminal);
  const round = observed.roundRef;
  const seated = view.participants.some(
    (seat) => 'actorId' in seat && seat.actorId === actorId,
  );
  return {
    ...observed,
    href:
      round && ['scheduled', 'active'].includes(round.status) && seated
        ? `/rounds/${round.id}/room`
        : null,
  };
}
