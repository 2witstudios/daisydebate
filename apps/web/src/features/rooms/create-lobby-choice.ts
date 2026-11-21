import type { StandingLobbyChoice } from '@daisy/protocol/lobby/eligibility';

export type CreateLobbyChoice = {
  readonly choices: readonly StandingLobbyChoice[];
  readonly defaultId: string;
};
