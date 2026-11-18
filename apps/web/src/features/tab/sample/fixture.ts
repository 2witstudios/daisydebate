import type { TabRoundFixture } from '@daisy/protocol/lobby/tab-round-read';

/** A sample's stand-in for a cuid2 id: the seed's letters, padded to 24. */
export const sampleId = (seed: string): string =>
  seed
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, '')
    .padEnd(24, '0')
    .slice(0, 24);

/** A sample instant on the tournament's day, given as its wall-clock time. */
export const sampleInstant = (time: string): string =>
  `2026-10-17T${time}:00.000Z`;

/** The samples' parts of a fixture that every state shares. */
export const sampleFixture = (
  title: string,
  room: string | null,
  judges: readonly string[],
  state: TabRoundFixture['state'],
  kind: TabRoundFixture['kind'] = 'pairing',
): TabRoundFixture => ({
  fixtureId: sampleId(`fixture${title}${room ?? ''}`),
  kind,
  label: null,
  entries: title
    .split(' v ')
    .map((name) => ({ entryId: sampleId(`entry${name}`), name })),
  room: room === null ? null : { roomId: sampleId(`room${room}`), name: room },
  judges: judges.map((name) => ({
    tournamentJudgeId: sampleId(`judge${name}`),
    name,
  })),
  conflict: false,
  state,
});
