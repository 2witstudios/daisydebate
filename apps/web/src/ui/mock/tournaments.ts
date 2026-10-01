import type { Entry, Viewer } from '../../features/tournaments/entry';
import type { Tournament } from '../../features/tournaments/tournament';

/** The signed-in viewer's sample handle and rating. */
export const sampleViewer: Viewer = {
  handle: 'debater-a',
  rating: 1620,
  established: true,
};

const noBand = { min: null, max: null } as const;

const base = {
  waitlisted: 0,
  band: noBand,
  organizer: 'Daisy Debate',
  featured: false,
  progress: null,
  outcome: null,
  registrationOpensAt: null,
  registrationClosesAt: null,
} satisfies Partial<Tournament>;

/**
 * Sample tournaments. Names, dates, counts and ratings are samples; every
 * registration and event state the screens show is reachable from these.
 */
export const sampleTournaments: readonly Tournament[] = [
  {
    ...base,
    id: 'autumn-open',
    name: 'Autumn Open',
    structure: 'single-elimination',
    rules: 'standard',
    places: 32,
    entered: 24,
    lifecycle: 'registration',
    startsAt: '2026-10-10T14:00:00.000Z',
    registrationOpensAt: '2026-09-21T09:00:00.000Z',
    registrationClosesAt: '2026-10-08T18:00:00.000Z',
    featured: true,
  },
  {
    ...base,
    id: 'weeknight-sprint',
    name: 'Weeknight Sprint',
    structure: 'single-elimination',
    rules: 'standard',
    places: 8,
    entered: 3,
    lifecycle: 'registration',
    startsAt: '2026-10-14T19:00:00.000Z',
    registrationOpensAt: '2026-09-28T09:00:00.000Z',
    registrationClosesAt: '2026-10-13T18:00:00.000Z',
  },
  {
    ...base,
    id: 'lantern-round-robin',
    name: 'Lantern Round Robin',
    structure: 'round-robin',
    rules: 'standard',
    places: 8,
    entered: 5,
    lifecycle: 'registration',
    startsAt: '2026-10-17T13:00:00.000Z',
    registrationOpensAt: '2026-09-29T09:00:00.000Z',
    registrationClosesAt: '2026-10-15T18:00:00.000Z',
  },
  {
    ...base,
    id: 'bronze-cup',
    name: 'Bronze Cup',
    structure: 'single-elimination',
    rules: 'standard',
    places: 16,
    entered: 6,
    lifecycle: 'registration',
    startsAt: '2026-10-24T14:00:00.000Z',
    registrationOpensAt: '2026-09-25T09:00:00.000Z',
    registrationClosesAt: '2026-10-22T18:00:00.000Z',
    band: { min: 1000, max: 1400 },
  },
  {
    ...base,
    id: 'novice-cup',
    name: 'Novice Cup',
    structure: 'single-elimination',
    rules: 'custom',
    places: 16,
    entered: 16,
    waitlisted: 3,
    lifecycle: 'registration',
    startsAt: '2026-10-03T15:00:00.000Z',
    registrationOpensAt: '2026-09-15T09:00:00.000Z',
    registrationClosesAt: '2026-10-02T18:00:00.000Z',
  },
  {
    ...base,
    id: 'night-owl-open',
    name: 'Night Owl Open',
    structure: 'single-elimination',
    rules: 'standard',
    places: 8,
    entered: 8,
    waitlisted: 2,
    lifecycle: 'registration',
    startsAt: '2026-10-21T20:00:00.000Z',
    registrationOpensAt: '2026-09-22T09:00:00.000Z',
    registrationClosesAt: '2026-10-20T18:00:00.000Z',
  },
  {
    ...base,
    id: 'hollow-cup',
    name: 'Hollow Cup',
    structure: 'single-elimination',
    rules: 'standard',
    places: 16,
    entered: 16,
    lifecycle: 'registration-closed',
    startsAt: '2026-10-05T14:00:00.000Z',
    registrationOpensAt: '2026-09-10T09:00:00.000Z',
    registrationClosesAt: '2026-09-29T18:00:00.000Z',
  },
  {
    ...base,
    id: 'frost-cup',
    name: 'Frost Cup',
    structure: 'single-elimination',
    rules: 'standard',
    places: 8,
    entered: 8,
    lifecycle: 'registration-closed',
    startsAt: '2026-10-06T19:00:00.000Z',
    registrationOpensAt: '2026-09-12T09:00:00.000Z',
    registrationClosesAt: '2026-09-28T18:00:00.000Z',
  },
  {
    ...base,
    id: 'winter-open',
    name: 'Winter Open',
    structure: 'single-elimination',
    rules: 'standard',
    places: 16,
    entered: 0,
    lifecycle: 'announced',
    startsAt: '2026-11-07T14:00:00.000Z',
    registrationOpensAt: '2026-10-12T09:00:00.000Z',
    registrationClosesAt: '2026-11-05T18:00:00.000Z',
  },
  {
    ...base,
    id: 'harvest-cup',
    name: 'Harvest Cup',
    structure: 'single-elimination',
    rules: 'standard',
    places: 8,
    entered: 8,
    lifecycle: 'in-progress',
    startsAt: '2026-09-30T12:00:00.000Z',
    progress: { when: 'Semifinals today, 14:00', note: 'Round 3 of 3 begins' },
  },
  {
    ...base,
    id: 'club-championship',
    name: 'Club Championship',
    structure: 'round-robin',
    rules: 'standard',
    places: 8,
    entered: 8,
    lifecycle: 'in-progress',
    startsAt: '2026-09-30T10:00:00.000Z',
    progress: {
      when: 'Round 3 of 7 today, 16:00',
      note: 'Standings update as ballots arrive',
    },
  },
  {
    ...base,
    id: 'summer-invitational',
    name: 'Summer Invitational',
    structure: 'single-elimination',
    rules: 'standard',
    places: 16,
    entered: 16,
    lifecycle: 'completed',
    startsAt: '2026-08-29T14:00:00.000Z',
    outcome: { label: 'Champion', handle: 'debater-c' },
  },
  {
    ...base,
    id: 'midsummer-round-robin',
    name: 'Midsummer Round Robin',
    structure: 'round-robin',
    rules: 'standard',
    places: 6,
    entered: 6,
    lifecycle: 'completed',
    startsAt: '2026-07-04T13:00:00.000Z',
    outcome: { label: 'Winner', handle: 'debater-d' },
  },
];

/** How the sample viewer stands in a few of them, keyed by tournament id. */
export const sampleEntries: Readonly<Record<string, Entry>> = {
  'harvest-cup': {
    kind: 'competing',
    stage: 'semifinal',
    note: 'Semifinal 1 at 14:00 vs @debater-c. Pairing is out.',
  },
  'autumn-open': {
    kind: 'registered',
    note: 'Starts Sat 10 Oct, 14:00. Check-in opens 10 minutes before.',
    firstOpponent: null,
  },
  'hollow-cup': {
    kind: 'registered',
    note: 'The bracket is out. Round 1 starts Mon 5 Oct, 14:00.',
    firstOpponent: 'debater-k',
  },
  'novice-cup': {
    kind: 'waitlisted',
    position: 2,
    note: 'Starts Sat 3 Oct. You move up if someone withdraws, and we tell you.',
  },
};

/** Sample entrants, in registration order; a null rating is provisional. */
export const sampleRoster: readonly {
  readonly handle: string;
  readonly rating: number | null;
}[] = [
  { handle: 'debater-a', rating: 1620 },
  { handle: 'debater-g', rating: 1650 },
  { handle: 'debater-c', rating: 1705 },
  { handle: 'debater-d', rating: 1690 },
  { handle: 'debater-b', rating: 1588 },
  { handle: 'debater-h', rating: 1540 },
  { handle: 'debater-i', rating: 1490 },
  { handle: 'debater-j', rating: 1475 },
  { handle: 'debater-k', rating: 1402 },
  { handle: 'debater-m', rating: null },
  ...Array.from({ length: 22 }, (_, i) => ({
    handle: `entrant-${String(i + 11)}`,
    rating: 1400 - i * 7,
  })),
];

/** Sample organizer description; real ones are up to 600 characters. */
export const sampleDescription = (name: string): string =>
  `${name} is open to debaters of every rating. Daisy handles pairings, judges, rooms and results, so you only need to show up on time. (Sample organizer description.)`;
