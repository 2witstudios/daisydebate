import type { Tournament } from './tournament';

export const NOW = '2026-09-30T12:00:00.000Z';

/** An open single-elimination tournament; override any field. */
export const tournament = (over: Partial<Tournament> = {}): Tournament => ({
  id: 'open-cup',
  name: 'Open Cup',
  structure: 'single-elimination',
  rules: 'standard',
  places: 16,
  entered: 8,
  waitlisted: 0,
  lifecycle: 'registration',
  startsAt: '2026-10-10T14:00:00.000Z',
  registrationOpensAt: '2026-09-20T09:00:00.000Z',
  registrationClosesAt: '2026-10-08T18:00:00.000Z',
  band: { min: null, max: null },
  organizer: 'Daisy Debate',
  featured: false,
  progress: null,
  outcome: null,
  ...over,
});
