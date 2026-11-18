import type {
  LeagueSchoolCommand,
  LeagueSchoolRefusal,
  LeagueSchoolStatus,
} from '@daisy/protocol/lobby/league-school-command';
import { refuse, type CommandDecision } from './run-command';

export type LeagueSchoolFacts = {
  readonly league: {
    readonly id: string;
    readonly kind: string;
    readonly version: number;
  };
  readonly school: { readonly id: string; readonly kind: string };
  readonly membership: {
    readonly id: string;
    readonly status: LeagueSchoolStatus;
    readonly version: number;
  } | null;
  readonly newId: string;
};
export type LeagueSchoolWrite = {
  readonly type: 'invite' | 'join' | 'end';
  readonly id: string;
  readonly version: number;
};
/**
 * An invitation records only league assent. School confirmation alone
 * activates it. Each membership period is its own aggregate.
 */
export const decideLeagueSchool = (
  facts: LeagueSchoolFacts,
  command: LeagueSchoolCommand,
): CommandDecision<LeagueSchoolRefusal, LeagueSchoolWrite> => {
  if (facts.league.kind !== 'league' || facts.school.kind !== 'school')
    return refuse('wrong-organization-kind');
  // An ended period is history: a new invitation opens a new period.
  const membership =
    facts.membership?.status === 'ended' ? null : facts.membership;
  let type: LeagueSchoolWrite['type'];
  switch (command.type) {
    case 'invite-league-school':
      if (membership?.status === 'active') return refuse('already-member');
      if (membership?.status === 'invited') return refuse('already-invited');
      type = 'invite';
      break;
    case 'accept-league-school':
      if (membership?.status !== 'invited') return refuse('invitation-closed');
      type = 'join';
      break;
    case 'end-league-school':
      if (!membership || membership.status === 'ended')
        return refuse('membership-ended');
      type = 'end';
      break;
  }
  return {
    kind: 'accepted',
    aggregate: { kind: 'league_school', id: membership?.id ?? facts.newId },
    resultingVersion: (membership?.version ?? 0) + 1,
    findings: [],
    fixtureChanges: [],
    writes: [
      {
        type,
        id: membership?.id ?? facts.newId,
        version: (membership?.version ?? 0) + 1,
      },
    ],
  };
};
