import {
  bandAccepts,
  statusOf,
  type Tournament,
  type TournamentStatus,
} from './tournament';

/** The signed-in viewer as tournaments see them. */
export type Viewer = {
  readonly handle: string;
  readonly rating: number;
  readonly established: boolean;
};

/** How the viewer stands in one tournament. `note` is sample copy. */
export type Entry =
  | {
      readonly kind: 'registered';
      readonly note: string;
      /** Once the bracket is out: the round 1 opponent (sample). */
      readonly firstOpponent: string | null;
    }
  | {
      readonly kind: 'waitlisted';
      readonly position: number;
      readonly note: string;
    }
  | {
      readonly kind: 'competing';
      readonly stage: string;
      readonly note: string;
    };

/** What the detail page's side panel shows. */
export type RegistrationState =
  | 'open'
  | 'registered'
  | 'full'
  | 'waitlisted'
  | 'closed'
  | 'signed-out'
  | 'not-open'
  | 'competing'
  | 'in-progress'
  | 'completed';

/** After registration opens, the status alone decides these. */
const settled: Readonly<Partial<Record<TournamentStatus, RegistrationState>>> =
  { done: 'completed', closed: 'closed', 'not-open': 'not-open' };

const entryStates = {
  registered: 'registered',
  waitlisted: 'waitlisted',
  competing: 'competing',
} as const;

function whileRegistering(
  status: TournamentStatus,
  viewer: Viewer | null,
  entry: Entry | null,
): RegistrationState {
  if (viewer === null) return 'signed-out';
  if (entry) return entryStates[entry.kind];
  return status === 'full' ? 'full' : 'open';
}

export function registrationState(
  tournament: Tournament,
  viewer: Viewer | null,
  entry: Entry | null,
): RegistrationState {
  const status = statusOf(tournament);
  if (status === 'live')
    return entry?.kind === 'competing' ? 'competing' : 'in-progress';
  return settled[status] ?? whileRegistering(status, viewer, entry);
}

export type Eligibility =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'closed' | 'outside-band' };

/** Whether the viewer may enter (or join the waitlist of) the tournament. */
export function entryEligibility(
  tournament: Tournament,
  viewer: Viewer,
): Eligibility {
  const status = statusOf(tournament);
  if (status !== 'open' && status !== 'full')
    return { ok: false, reason: 'closed' };
  return bandAccepts(tournament.band, viewer.rating)
    ? { ok: true }
    : { ok: false, reason: 'outside-band' };
}
