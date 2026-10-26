import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireWorkerPrincipalShape } from './bot-worker-authority';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const principal = {
  kind: 'agent' as const,
  agentRunId: id('a'),
  serviceId: `agent-run:${id('a')}`,
  participantId: id('b'),
  publicationEpoch: 1,
};

test('a worker principal carries well-formed ids, a positive epoch and its own service', async () => {
  assert({
    given: 'a principal bound to its own run',
    should: 'admit it',
    actual: requireWorkerPrincipalShape(principal, id('c')),
    expected: undefined,
  });
  for (const [label, changed, roundId] of [
    ['a malformed Round id', principal, 'Round-1'],
    ['a malformed run id', { ...principal, agentRunId: 'x' }, id('c')],
    ['a malformed seat id', { ...principal, participantId: '' }, id('c')],
    ['a zero epoch', { ...principal, publicationEpoch: 0 }, id('c')],
    ['a fractional epoch', { ...principal, publicationEpoch: 1.5 }, id('c')],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse as invalid input',
      actual: () => requireWorkerPrincipalShape(changed, roundId),
      code: 'VALIDATION',
    });
  await assertRejects({
    given: "a service bound to another run's identity",
    should: 'refuse authority',
    actual: () =>
      requireWorkerPrincipalShape(
        { ...principal, serviceId: `agent-run:${id('d')}` },
        id('c'),
      ),
    code: 'AUTHORIZATION',
  });
});
