import type { DayRow } from '@daisy/protocol/lobby/day-read';
import type { TabRoundRef } from '@daisy/protocol/lobby/lobby-read';

/**
 * A sample id: the same 24 lowercase characters for the same key, so the
 * sample's records can name each other the way stored ids do.
 */
export function sampleId(key: string): string {
  let out = '';
  for (let round = 0; out.length < 24; round += 1) {
    let hash = 0x811c9dc5 ^ round;
    for (const char of key) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(36).padStart(7, '0');
  }
  return out.slice(0, 24);
}

/** An instant on the sample's calendar, in UTC. */
export const at = (day: string, time: string): string =>
  `${day}T${time}:00.000Z`;

export const tabRound = (
  lobby: string,
  event: string,
  number: number,
  name: string | null = null,
  stage: TabRoundRef['stage'] = 'preliminary',
): TabRoundRef => ({
  tabRoundId: sampleId(`${lobby}/${event}/round-${number}`),
  eventId: sampleId(`${lobby}/${event}`),
  number,
  name,
  stage,
});

const won = (
  judgesFor = 1,
  judgesAgainst = 0,
  points: number | null = null,
): DayRow['result'] => ({
  kind: 'released',
  decision: { kind: 'debate', won: true, judgesFor, judgesAgainst },
  scores: points === null ? null : { points },
});
