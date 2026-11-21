import type { AgeBand } from '../ladder';
import type { CompetitionType } from '../round';

export const lobbyAgeRules = ['adults', 'under-18', 'anyone'] as const;
export type LobbyAgeRule = (typeof lobbyAgeRules)[number];

export type DebaterEligibility = {
  readonly ageBand: AgeBand | null;
  readonly guardianAllowed: boolean;
};

export type StandingLobbyChoice = {
  readonly id: string;
  readonly name: string;
  readonly ageRule: LobbyAgeRule;
};

/** Prefer an age-specific lobby, then an unrestricted one. */
export function defaultStandingLobby<Lobby extends StandingLobbyChoice>(
  choices: readonly Lobby[],
  ageBand: AgeBand | null,
): Lobby | null {
  const preferred =
    ageBand === null || ageBand === 'adult' ? 'adults' : 'under-18';
  return (
    choices.find((lobby) => lobby.ageRule === preferred) ??
    choices.find((lobby) => lobby.ageRule === 'anyone') ??
    null
  );
}

/** Room debater eligibility. Account admission and permission to judge are separate. */
export function mayDebate(
  { ageBand, guardianAllowed }: DebaterEligibility,
  lobby: {
    readonly ageRule: LobbyAgeRule;
    readonly competitionType: CompetitionType;
  },
): boolean {
  if (ageBand === null)
    return lobby.ageRule !== 'under-18' && lobby.competitionType === 'casual';
  switch (lobby.ageRule) {
    case 'adults':
      return ageBand === 'adult' || guardianAllowed;
    case 'under-18':
      return ageBand !== 'adult';
    case 'anyone':
      return true;
  }
}
