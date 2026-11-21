import type { LobbyAgeRule } from '@daisy/protocol/lobby/eligibility';

export const ageRuleLabel: Readonly<Record<LobbyAgeRule, string>> = {
  anyone: 'Anyone',
  adults: 'Adults',
  'under-18': 'Under 18',
};
