import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideLeagueSchool, type LeagueSchoolFacts } from './league-schools';
import {
  leagueSchoolController,
  type LeagueSchoolCommand,
} from '@daisy/protocol/lobby/league-school-command';
setupRitewayBun();
const leagueId = 'lguvh1y1ejhadk96xcftohha',
  schoolId = 'qndsohpp7nihje7a2dw3a2kl';
const facts: LeagueSchoolFacts = {
  league: { id: leagueId, kind: 'league', version: 3 },
  school: { id: schoolId, kind: 'school' },
  membership: null,
  newId: 'lrp9sdclvjac1h76c3yxiob3',
};
const command = (
  type: 'invite-league-school' | 'accept-league-school',
): LeagueSchoolCommand => ({ type, leagueId, schoolId });
test('only a league invitation followed by school assent activates membership', () => {
  const invited = decideLeagueSchool(facts, command('invite-league-school'));
  const active = decideLeagueSchool(
    {
      ...facts,
      membership: { id: facts.newId, status: 'invited', version: 1 },
    },
    command('accept-league-school'),
  );
  assert({
    given: 'no relation and then an invited relation',
    should: 'describe invitation and activation as separate audited writes',
    actual: [
      invited.kind === 'accepted' && invited.writes,
      active.kind === 'accepted' && active.writes,
    ],
    expected: [
      [{ type: 'invite', id: facts.newId, version: 1 }],
      [{ type: 'join', id: facts.newId, version: 2 }],
    ],
  });
  assert({
    given:
      'no invitation, already accepted invitation, and wrong organization kinds',
    should: 'refuse invalid joins and duplicate membership',
    actual: [
      decideLeagueSchool(facts, command('accept-league-school')),
      decideLeagueSchool(
        {
          ...facts,
          membership: { id: facts.newId, status: 'active', version: 2 },
        },
        command('invite-league-school'),
      ),
      decideLeagueSchool(
        { ...facts, school: { ...facts.school, kind: 'league' } },
        command('invite-league-school'),
      ),
    ],
    expected: [
      { kind: 'refused', refusal: 'invitation-closed' },
      { kind: 'refused', refusal: 'already-member' },
      { kind: 'refused', refusal: 'wrong-organization-kind' },
    ],
  });
});
test('each command names exactly its own organization controller', () => {
  assert({
    given: 'invite, school confirmation and either-side termination',
    should: 'ask organization.manage on the correct organization',
    actual: [
      command('invite-league-school'),
      command('accept-league-school'),
      { type: 'end-league-school', leagueId, schoolId, side: 'league' },
      { type: 'end-league-school', leagueId, schoolId, side: 'school' },
    ].map((c) => leagueSchoolController(c as LeagueSchoolCommand)),
    expected: [leagueId, schoolId, leagueId, schoolId],
  });
  const end = {
    type: 'end-league-school',
    leagueId,
    schoolId,
    side: 'school',
  } as const;
  assert({
    given: 'active membership and a repeated termination',
    should: 'end explicitly once and refuse later fresh end commands',
    actual: [
      decideLeagueSchool(
        {
          ...facts,
          membership: { id: facts.newId, status: 'active', version: 2 },
        },
        end,
      ),
      decideLeagueSchool(
        {
          ...facts,
          membership: { id: facts.newId, status: 'ended', version: 3 },
        },
        end,
      ),
    ],
    expected: [
      {
        kind: 'accepted',
        aggregate: { kind: 'league_school', id: facts.newId },
        resultingVersion: 3,
        findings: [],
        fixtureChanges: [],
        writes: [{ type: 'end', id: facts.newId, version: 3 }],
      },
      { kind: 'refused', refusal: 'membership-ended' },
    ],
  });
});
