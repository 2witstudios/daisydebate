import type { RoundTimeStatus } from './round-time';

const ANNOUNCEMENTS = {
  seed: 'Synchronizing round clock…',
  stale: 'Round clock may be out of date. Reconnecting…',
  current: 'Round clock synchronized',
} as const;

/** Only the state is announced: the number changes on every sample. */
export const roundTimeNotice = ({ kind, uncertaintyMs }: RoundTimeStatus) => ({
  announcement: ANNOUNCEMENTS[kind],
  detail: kind === 'current' ? `±${Math.ceil(uncertaintyMs ?? 0)} ms` : null,
});
