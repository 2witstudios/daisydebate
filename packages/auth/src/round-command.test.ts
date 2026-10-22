import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  bindRoundCommandPrincipal,
  type RoundCommandAuthority,
} from './round-command';
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
