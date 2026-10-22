import { assert, setupRitewayBun, test } from 'riteway/bun';
import { bindRoundCommandPrincipal } from './round-command';
import type { RoundCommandAuthority } from '@daisy/protocol';
setupRitewayBun();
const authority: RoundCommandAuthority = {
  roundId: 'round',
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

test('start and missing eligibility refuse closed without fabricating an actor', () => {
  const human = { kind: 'human', actorId: 'host' } as const;
  const agent = {
    kind: 'agent',
    serviceId: 'worker',
    agentRunId: 'run',
    roundId: 'round',
    participantId: 'bot-seat',
  } as const;
  for (const [principal, expected] of [
    [human, true],
    [{ ...human, actorId: 'outsider' }, false],
    [agent, false],
  ] as const)
    assert({
      given: JSON.stringify(principal),
      should: 'allow only the host to start',
      actual: bindRoundCommandPrincipal({
        principal,
        authority,
        command: { type: 'start' },
      }).ok,
      expected,
    });
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
  assert({
    given: 'the eligible host',
    should: 'start without a participant impersonation',
    actual: bindRoundCommandPrincipal({
      principal: human,
      authority,
      command: { type: 'start' },
    }),
    expected: { ok: true, actorId: null, participantId: null },
  });
});
