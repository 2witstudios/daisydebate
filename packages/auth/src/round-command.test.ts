import { assert, setupRitewayBun, test } from 'riteway/bun';
import { bindRoundCommandPrincipal } from './round-command';
import type { RoundCommandAuthority } from '@daisy/protocol';
setupRitewayBun();
const authority: RoundCommandAuthority = {
  roundId: 'round',
  // An admitted participant (ADR 0075).
  principalAccess: { beta: 'approved', ageBand: 'adult', restricted: false },
  hostActorId: 'host',
  participants: [
    {
      id: 'human-seat',
      actorId: 'person',
      role: 'affirmative',
      slot: 0,
      kind: 'human',
      eligible: true,
    },
    {
      id: 'bot-seat',
      actorId: 'bot',
      role: 'negative',
      slot: 0,
      kind: 'bot',
      eligible: true,
    },
  ],
  agentRun: {
    id: 'run',
    participantId: 'bot-seat',
    serviceId: 'worker',
    active: true,
  },
};
test('principal binding refuses seat theft and escaped AgentRun scope', () => {
  const human = { kind: 'human', actorId: 'person' } as const;
  const agent = {
    kind: 'agent',
    serviceId: 'worker',
    agentRunId: 'run',
    roundId: 'round',
    participantId: 'bot-seat',
  } as const;
  const cases = [
    [human, 'human-seat', true],
    [human, 'bot-seat', false],
    [agent, 'bot-seat', true],
    [agent, 'human-seat', false],
    [{ ...agent, roundId: 'foreign' }, 'bot-seat', false],
    [{ ...agent, agentRunId: 'foreign' }, 'bot-seat', false],
    [{ ...agent, serviceId: 'other-worker' }, 'bot-seat', false],
  ] as const;
  for (const [principal, participantId, expected] of cases)
    assert({
      given: `${JSON.stringify(principal)} acting as ${participantId}`,
      should: 'bind only its authorized seat',
      actual: bindRoundCommandPrincipal({
        principal,
        authority,
        command: { type: 'yield', participantId },
      }).ok,
      expected,
    });
});

test('missing eligibility refuses closed without fabricating an actor', () => {
  const agent = {
    kind: 'agent',
    serviceId: 'worker',
    agentRunId: 'run',
    roundId: 'round',
    participantId: 'bot-seat',
  } as const;
  for (const agentRun of [
    null,
    { ...authority.agentRun!, active: false },
    { ...authority.agentRun!, participantId: 'other-seat' },
  ])
    assert({
      given: 'missing, finished or foreign assigned run',
      should: 'refuse its service principal',
      actual: bindRoundCommandPrincipal({
        principal: agent,
        authority: { ...authority, agentRun },
        command: { type: 'yield', participantId: 'bot-seat' },
      }),
      expected: { ok: false, refusal: 'not-authorized' },
    });
  for (const participants of [
    [],
    [{ ...authority.participants[0]!, eligible: false }],
    [{ ...authority.participants[0]!, role: 'judge' as const }],
  ])
    assert({
      given: 'missing, ineligible or judge seat',
      should: 'refuse competitive acting authority',
      actual: bindRoundCommandPrincipal({
        principal: { kind: 'human', actorId: 'person' },
        authority: { ...authority, participants },
        command: { type: 'forfeit', participantId: 'human-seat' },
      }),
      expected: { ok: false, refusal: 'not-seated' },
    });
});

test('a human without participant access keeps only the Round withdrawal (ADR 0075)', () => {
  const person = { kind: 'human', actorId: 'person' } as const;
  const agent = {
    kind: 'agent',
    serviceId: 'worker',
    agentRunId: 'run',
    roundId: 'round',
    participantId: 'bot-seat',
  } as const;
  const bound = (
    principalAccess: RoundCommandAuthority['principalAccess'],
    principal: typeof person | typeof agent,
    command: Parameters<typeof bindRoundCommandPrincipal>[0]['command'],
  ) =>
    bindRoundCommandPrincipal({
      principal,
      authority: { ...authority, principalAccess },
      command,
    }).ok;
  const revoked = {
    beta: 'revoked',
    ageBand: 'adult',
    restricted: false,
  } as const;
  const ageless = {
    beta: 'approved',
    ageBand: null,
    restricted: false,
  } as const;
  assert({
    given:
      'a revoked and an age-less human commanding yield and forfeit, and an AgentRun with no human facts',
    should:
      'refuse every participation command, keep forfeit (leaving the Round), and leave AgentRuns to their own scope',
    actual: [
      bound(revoked, person, { type: 'yield', participantId: 'human-seat' }),
      bound(ageless, person, { type: 'yield', participantId: 'human-seat' }),
      bound(revoked, person, {
        type: 'forfeit',
        participantId: 'human-seat',
      }),
      bound(null, agent, { type: 'yield', participantId: 'bot-seat' }),
    ],
    expected: [false, false, true, true],
  });
});
