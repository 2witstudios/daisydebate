import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildDebateTopic, buildUserInboxTopic } from '@daisy/protocol';
import { fixture, row } from './registry.test-support';
setupRitewayBun();
for (const mode of ['round', 'inbox'] as const)
  test(`${mode} bell delivery rechecks current canonical access`, async () => {
    let allowed = true;
    let checks = 0;
    const f = fixture({
      authorize: async () => {
        checks += 1;
        return allowed ? { revision: '1', validUntil: 60_000 } : null;
      },
    });
    const roundId = 'b'.repeat(24);
    const topic =
      mode === 'round'
        ? buildDebateTopic(roundId)
        : buildUserInboxTopic(f.connection.principal.actorId);
    const payload =
      mode === 'round'
        ? { kind: 'debate.phase-changed', ids: [roundId], entityVersion: 1 }
        : { kind: 'messaging.inbox.changed' };
    await f.registry.subscribe(f.connection, { id: 'round', topic });
    allowed = false;
    f.registry.sink([
      {
        ...row(1),
        topic,
        kind: payload.kind,
        payload,
      },
    ]);
    await f.registry.settled();
    assert({
      given:
        'a canonical content-free topic bell after its formerly allowed audience is revoked',
      should:
        'refresh authority before native delivery and detach the denied recipient',
      actual: [checks, f.sent.map((frame) => frame.type), f.attached.size],
      expected: [2, ['subscribed'], 0],
    });
  });
