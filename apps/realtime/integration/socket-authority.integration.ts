import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '@daisy/protocol';
import {
  socketAuthorityFixture,
  authenticatedAuthorityPeer,
  issueAuthorityTicket,
} from './socket-authority.test-support';
import { testOrigin } from './support';

setupRitewayBun();
requireTestServices(process.env);

type Fixture = Awaited<ReturnType<typeof socketAuthorityFixture>>;

/** ADR 0075: an operator revoke, as the signed command commits it. */
const revokeBeta = (fixture: Fixture) =>
  fixture.client.begin(async (tx) => {
    await tx`update account_beta_access set state='revoked', revision=revision+1, decided_at=now() where user_id=${fixture.userId}`;
    await tx`update users set version=version+1 where id=${fixture.userId}`;
  });

for (const change of [
  'revoked',
  'expired',
  'erased',
  'beta-revoked',
  'age-removed',
] as const)
  test(`actual periodic authorization closes a ${change} durable session without an outbox event`, async () => {
    const fixture = await socketAuthorityFixture();
    try {
      const peer = await authenticatedAuthorityPeer(fixture);
      if (change === 'revoked')
        await fixture.client`delete from session where id=${fixture.sessionId}`;
      else if (change === 'beta-revoked') await revokeBeta(fixture);
      else if (change === 'age-removed')
        await fixture.client`delete from account_age where user_id=${fixture.userId}`;
      else if (change === 'erased')
        await fixture.client`update users set username=null,deleted_at='2026-10-09T00:00:00Z',version=version+1 where id=${fixture.userId}`;
      else
        await fixture.client`update session set expires_at='2026-10-09T00:00:30Z' where id=${fixture.sessionId}`;
      fixture.advanceToRevalidation();
      assert({
        given:
          'a real authenticated subscribed socket and durable session changed without publishing an event',
        should: 'close revoked from the actual periodic current-session reader',
        actual: await peer.closed,
        expected: 4002,
      });
    } finally {
      await fixture.close();
    }
  });

test('a ticket issued before a beta revoke never redeems after it (ADR 0075)', async () => {
  const fixture = await socketAuthorityFixture();
  try {
    const ticket = await issueAuthorityTicket(fixture);
    await revokeBeta(fixture);
    const socket = new WebSocket(
      `ws://127.0.0.1:${fixture.runtime.server.port}/ws`,
      { headers: { origin: testOrigin } },
    );
    const closed = new Promise<number>((accept) =>
      socket.addEventListener('close', (event) => accept(event.code)),
    );
    socket.addEventListener('open', () =>
      socket.send(
        JSON.stringify({
          v: ENVELOPE_VERSION,
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          ticket,
        }),
      ),
    );
    assert({
      given:
        'a real single-use ticket issued for an approved account that is revoked before redemption',
      should: 'refuse the redemption as auth_failed (4001)',
      actual: await closed,
      expected: 4001,
    });
  } finally {
    await fixture.close();
  }
});
