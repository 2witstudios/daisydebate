import {
  sampleDescription,
  sampleEntries,
  sampleRoster,
  sampleTournaments,
  sampleViewer,
} from '../../ui/mock/tournaments';
import {
  registrationState,
  type Entry,
  type RegistrationState,
  type Viewer,
} from './entry';
import { recognitionFor, type Recognition } from './recognition';
import { scheduleFor, type ScheduleItem } from './schedule';
import type { Tournament } from './tournament';

export type Entrant = {
  readonly handle: string;
  /** Null while provisional. */
  readonly rating: number | null;
  /** UTC ISO timestamp. */
  readonly registeredAt: string;
};

export type TournamentView = {
  readonly viewer: Viewer | null;
  readonly tournament: Tournament;
  readonly entry: Entry | null;
  readonly state: RegistrationState;
  readonly description: string;
  readonly schedule: readonly ScheduleItem[];
  readonly recognition: readonly Recognition[];
  readonly entrants: readonly Entrant[];
};

const DAY_MS = 86_400_000;

/**
 * The detail page's one data seam: a tournament as the viewer sees it, or
 * null for an unknown id. The backend read replaces this function only.
 */
export function getTournament(
  id: string,
  signedIn: boolean,
): TournamentView | null {
  const tournament = sampleTournaments.find((item) => item.id === id);
  if (!tournament) return null;
  const viewer = signedIn ? sampleViewer : null;
  const entry = viewer ? (sampleEntries[id] ?? null) : null;
  const opened = Date.parse(
    tournament.registrationOpensAt ?? tournament.startsAt,
  );
  return {
    viewer,
    tournament,
    entry,
    state: registrationState(tournament, viewer, entry),
    description: sampleDescription(tournament.name),
    schedule: scheduleFor(tournament),
    recognition: recognitionFor(tournament.structure),
    entrants: sampleRoster.slice(0, tournament.entered).map((who, index) => ({
      ...who,
      registeredAt: new Date(opened + (index % 5) * DAY_MS).toISOString(),
    })),
  };
}
