import type { LobbyAgeRule } from '@daisy/protocol/lobby/eligibility';
import type { TournamentSetupView } from '@daisy/protocol/lobby/lobby-setup-read';

export const ageRuleLabels: Readonly<Record<LobbyAgeRule, string>> = {
  adults: '18 and over',
  'under-18': 'Under 18',
  anyone: 'Any admitted age',
};

export const tournamentAgeRule = (
  eligibility: TournamentSetupView['eligibility'],
) => {
  const rule = ageRuleLabels[eligibility.ageRule];
  return eligibility.kind === 'standing'
    ? `${eligibility.lobbyName} · ${rule}`
    : rule;
};
