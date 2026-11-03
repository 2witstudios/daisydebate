import type { RuntimeCheckpoint } from '@daisy/protocol';

/** The words every viewer of a held Round reads: seats, judges and spectators alike. */
const HELD =
  "Daisy's media server failed. Your time is safe. Resuming when everyone is back.";

/** What a held Round says at one instant; null when nothing holds it. */
export function roundIncidentNotice(
  checkpoint: RuntimeCheckpoint | null,
  nowMs: number,
): { readonly held: string; readonly resumesInSeconds: number | null } | null {
  const incident = checkpoint?.incident;
  if (!incident || incident.phase === 'none') return null;
  if (incident.phase === 'paused')
    return { held: HELD, resumesInSeconds: null };
  const leftMs = Date.parse(incident.until) - nowMs;
  return leftMs <= 0
    ? null
    : { held: HELD, resumesInSeconds: Math.ceil(leftMs / 1000) };
}
