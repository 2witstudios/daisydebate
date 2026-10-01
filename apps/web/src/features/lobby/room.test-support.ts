import type { LiveRoom, OpenRoom, RatingBand } from './room';

export const NOW = '2026-09-30T12:00:00.000Z';

const anyBand: RatingBand = { min: null, max: null };

/** An open ranked table; override any field. */
export const openRoom = (over: Partial<OpenRoom> = {}): OpenRoom => ({
  id: 'open-1',
  name: 'Open table',
  mode: 'ranked',
  customRules: false,
  host: { handle: 'host-one', rating: 1500 },
  status: 'open',
  band: anyBand,
  waitingSince: '2026-09-30T11:58:00.000Z',
  ...over,
});

/** A live ranked room; override any field. */
export const liveRoom = (over: Partial<LiveRoom> = {}): LiveRoom => ({
  id: 'live-1',
  name: 'Live room',
  mode: 'ranked',
  customRules: false,
  host: { handle: 'debater-a', rating: 1600 },
  status: 'live',
  opponent: { handle: 'debater-b', rating: 1500 },
  watching: 10,
  ...over,
});
