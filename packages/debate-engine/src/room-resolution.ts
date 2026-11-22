import type { RoomResolutionSelection } from '@daisy/protocol/room-resolution';

/**
 * The resolution a new Room starts with (ADR 0092, amended by ADR 0142). The
 * Freestyle standard strikes from Daisy's bank, so a standard Room must
 * choose Strike; the choice must agree with whether the rules strike, and
 * Custom wording becomes the topic. A draw Room's topic is null until the
 * reveal.
 */
export function decideRoomResolution({
  selection,
  standard,
  strikes,
}: {
  readonly selection: RoomResolutionSelection;
  readonly standard: boolean;
  readonly strikes: boolean;
}):
  | { readonly ok: true; readonly topic: string | null }
  | { readonly ok: false } {
  if (standard && selection.kind !== 'strike') return { ok: false };
  if ((selection.kind === 'strike') !== strikes) return { ok: false };
  return selection.kind === 'strike'
    ? { ok: true, topic: null }
    : { ok: true, topic: selection.text };
}
