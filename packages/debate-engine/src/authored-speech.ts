/**
 * The words of an authored bot phrase that were actually heard when its
 * playout stopped after `playedFraction` of its audio (ADR 0122): the whole
 * words nearest that fraction, never more than were played and never text
 * the phrase did not contain. A fraction outside [0, 1] is clamped.
 */
export function spokenPrefix(text: string, playedFraction: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const fraction = Number.isFinite(playedFraction)
    ? Math.min(1, Math.max(0, playedFraction))
    : 0;
  return words.slice(0, Math.round(fraction * words.length)).join(' ');
}
