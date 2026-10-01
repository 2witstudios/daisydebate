import {
  sampleAttention,
  sampleOrganized,
} from '../../ui/mock/tournament-organizer';

/** Where an organizer's tournament is in its life. */
export type OrganizePhase =
  'draft' | 'registration' | 'in-progress' | 'completed';

type OrganizeAction = { readonly label: string; readonly href: string };

export type OrganizedTournament = {
  readonly id: string;
  readonly name: string;
  readonly phase: OrganizePhase;
  readonly summary: string;
  /** Sample wording: what needs doing next. */
  readonly note: string;
  readonly action: OrganizeAction;
};

export type AttentionItem = {
  readonly title: string;
  readonly detail: string;
  readonly action: OrganizeAction | null;
};

export type PhaseCount = { readonly label: string; readonly count: number };

export type OrganizeDashboard = {
  readonly counts: readonly PhaseCount[];
  readonly tournaments: readonly OrganizedTournament[];
  readonly attention: readonly AttentionItem[];
};

const countLabels: readonly (readonly [OrganizePhase, string])[] = [
  ['in-progress', 'In progress'],
  ['registration', 'Open for registration'],
  ['draft', 'Drafts'],
];

/** Counts for the three live phases; completed tournaments are not counted. */
export const phaseCounts = (
  tournaments: readonly OrganizedTournament[],
): readonly PhaseCount[] =>
  countLabels.map(([phase, label]) => ({
    label,
    count: tournaments.filter((item) => item.phase === phase).length,
  }));

/**
 * The organizer dashboard's one seam: any signed-in organizer's own
 * tournaments and what needs them. The backend read replaces this function
 * only. Organizing is a participant-app surface, never an admin one.
 */
export function getOrganizeDashboard(): OrganizeDashboard {
  return {
    counts: phaseCounts(sampleOrganized),
    tournaments: sampleOrganized,
    attention: sampleAttention,
  };
}
