import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { gatedRead, type GateDecision } from './gated-read';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
const authority = {
  principal: { kind: 'user', userId: id('u'), actorId: id('a') },
  resource: { kind: 'room_collection' },
  context: { account: null },
} as Omit<AuthorizationInput, 'capability'>;
const conflict = {
  connections: [{ basis: 'seated' }],
  handling: 'flagged',
  waiverId: null,
} as never;

const read = (decision: AuthorizationDecision) =>
  gatedRead(
    () => decision,
    { gate: ['lobby.host.read'] } as never,
    async () => ({ facts: 'facts', authority }),
    (_facts, _ask, gate: GateDecision) =>
      gate.kind === 'allowed' ? gate.decision.conflict : 'signed-in',
  );

describe('gatedRead (TAB-5.13)', async () => {
  test('the gate decision reaches the projection', async () => {
    assert({
      given: 'a read its gate allows with a flagged conflict',
      should: 'hand the projection the conflict, to show the official less',
      actual: await read({
        allow: true,
        authority: { kind: 'grant', grantId: id('g') },
        conflict,
      }),
      expected: conflict,
    });
    assert({
      given: 'a read its gate denies',
      should: 'answer as a missing resource',
      actual: await read({
        allow: false,
        reason: 'missing-capability',
        conflict: null,
      }),
      expected: null,
    });
  });
});
