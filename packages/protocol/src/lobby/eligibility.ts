import type { AgeBand } from '../ladder';
import { competitionTypes, type CompetitionType } from '../round';

export const lobbyAgeRules = ['adults', 'under-18', 'anyone'] as const;
export type LobbyAgeRule = (typeof lobbyAgeRules)[number];

export type DebaterEligibility = {
  readonly ageBand: AgeBand | null;
  readonly guardianLobbyIds?: readonly string[] | undefined;
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
  { ageBand, guardianLobbyIds }: DebaterEligibility,
  lobby: {
    readonly lobbyId: string;
    readonly ageRule: LobbyAgeRule;
    readonly competitionType: CompetitionType;
  },
): boolean {
  if (ageBand === null)
    return lobby.ageRule !== 'under-18' && lobby.competitionType === 'casual';
  if (ageBand === 'under-13') return false;
  switch (lobby.ageRule) {
    case 'adults':
      return (
        ageBand === 'adult' ||
        guardianLobbyIds?.includes(lobby.lobbyId) === true
      );
    case 'under-18':
      return ageBand !== 'adult';
    case 'anyone':
      return true;
  }
}

/** An age band a guardian's evidence speaks for: thirteen to seventeen. */
export const isMinorAgeBand = (ageBand: AgeBand | null) =>
  ageBand === '13-15' || ageBand === '16-17';

/**
 * Who may open a standing Room in a lobby: anyone who may debate in it, and
 * club staff, who may also open a Youth Room for their students.
 */
export const mayHostStandingRoom = (
  creator: DebaterEligibility & { readonly clubStaff: boolean },
  lobby: {
    readonly lobbyId: string;
    readonly ageRule: LobbyAgeRule;
    readonly competitionType: CompetitionType;
  },
): boolean =>
  (creator.clubStaff && lobby.ageRule === 'under-18') ||
  mayDebate(creator, lobby);

/** One debater's ages by lobby and guardian waivers, as a challenge reads them. */
export type ChallengeDebater = {
  readonly preferredAgeBand: AgeBand | null;
  readonly ageByLobby: ReadonlyMap<string, AgeBand | null>;
  readonly guardianLobbyIds: readonly string[];
};

/**
 * The standing lobby two debaters may both debate in for `mode`: the
 * challenger's preferred band's default among the shared ones, else the first.
 */
export const sharedChallengeLobby = (
  choices: readonly StandingLobbyChoice[],
  first: ChallengeDebater,
  second: ChallengeDebater,
  mode: CompetitionType,
) => {
  const shared = choices.filter((lobby) =>
    [first, second].every((member) =>
      mayDebate(
        {
          ageBand: member.ageByLobby.get(lobby.id) ?? null,
          guardianLobbyIds: member.guardianLobbyIds,
        },
        {
          lobbyId: lobby.id,
          ageRule: lobby.ageRule,
          competitionType: mode,
        },
      ),
    ),
  );
  return (
    defaultStandingLobby(shared, first.preferredAgeBand) ?? shared[0] ?? null
  );
};

export const challengeModes = (
  choices: readonly StandingLobbyChoice[],
  own: ChallengeDebater | undefined,
  their: ChallengeDebater | undefined,
) =>
  own && their
    ? competitionTypes.filter((mode) =>
        sharedChallengeLobby(choices, own, their, mode),
      )
    : [];
