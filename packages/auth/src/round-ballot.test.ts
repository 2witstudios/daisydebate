import { assert, setupRitewayBun, test } from 'riteway/bun';
import type {
  RoundBallotAuthority,
  RoundCommandPrincipal,
} from '@daisy/protocol';
import { bindRoundBallotPrincipal } from './round-ballot';
setupRitewayBun();
const authority: RoundBallotAuthority = {
  roundId: 'round',
  // An admitted participant (ADR 0075).
  principalAccess: { beta: 'approved', ageBand: 'adult' },
  participants: [
    {
      id: 'human',
      actorId: 'person',
      role: 'judge',
      slot: 0,
      kind: 'human',
      eligible: true,
    },
    {
      id: 'bot',
      actorId: 'machine',
      role: 'judge',
      slot: 1,
      kind: 'bot',
      eligible: true,
    },
    {
      id: 'debater',
      actorId: 'player',
      role: 'affirmative',
      slot: 0,
      kind: 'human',
      eligible: true,
    },
  ],
  agentRun: {
    id: 'run',
    participantId: 'bot',
    serviceId: 'agent-run:run',
    active: true,
    kind: 'judging',
  },
};
const agent = {
  kind: 'agent',
  agentRunId: 'run',
  participantId: 'bot',
  roundId: 'round',
  serviceId: 'agent-run:run',
} as const;
test('assigned human and exactly scoped judging service principals share one ballot authority', () => {
  const cases: readonly (readonly [RoundCommandPrincipal, string, boolean])[] =
    [
      [{ kind: 'human', actorId: 'person' }, 'human', true],
      [agent, 'bot', true],
      [{ kind: 'human', actorId: 'player' }, 'human', false],
      [{ kind: 'human', actorId: 'person' }, 'bot', false],
      [agent, 'human', false],
      [agent, 'missing', false],
      [{ kind: 'human', actorId: 'player' }, 'debater', false],
      [{ ...agent, roundId: 'foreign' }, 'bot', false],
      [{ ...agent, agentRunId: 'foreign' }, 'bot', false],
      [{ ...agent, serviceId: 'worker' }, 'bot', false],
      [{ ...agent, participantId: 'human' }, 'human', false],
    ];
  assert({
    given: 'assigned judges, stolen seats and escaped service scopes',
    should: 'bind only the current assigned judge principal',
    actual: cases.map(
      ([principal, judgeParticipantId]) =>
        bindRoundBallotPrincipal({ principal, judgeParticipantId, authority })
          .ok,
    ),
    expected: cases.map((c) => c[2]),
  });
});
test('revoked eligibility, ended runs and nonjudging purposes refuse closed', () => {
  const runs = [
    null,
    { ...authority.agentRun!, active: false },
    { ...authority.agentRun!, kind: 'speech' },
  ];
  assert({
    given: 'missing, ended or speech-only service runs',
    should: 'never grant ballot authority',
    actual: runs.map(
      (agentRun) =>
        bindRoundBallotPrincipal({
          principal: agent,
          judgeParticipantId: 'bot',
          authority: { ...authority, agentRun },
        }).ok,
    ),
    expected: [false, false, false],
  });
  assert({
    given: 'a canonically ineligible human judge',
    should: 'refuse even on replay',
    actual: bindRoundBallotPrincipal({
      principal: { kind: 'human', actorId: 'person' },
      judgeParticipantId: 'human',
      authority: {
        ...authority,
        participants: authority.participants.map((p) => ({
          ...p,
          eligible: false,
        })),
      },
    }).ok,
    expected: false,
  });
});

test('a judge without participant access cannot cast a ballot (ADR 0075)', () => {
  assert({
    given: 'the assigned human judge after a beta revoke',
    should: 'refuse the ballot: judging is participation, never a withdrawal',
    actual: bindRoundBallotPrincipal({
      principal: { kind: 'human', actorId: 'person' },
      judgeParticipantId: 'human',
      authority: {
        ...authority,
        principalAccess: { beta: 'revoked', ageBand: 'adult' },
      },
    }).ok,
    expected: false,
  });
});
