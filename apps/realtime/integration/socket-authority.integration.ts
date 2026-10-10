import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  socketAuthorityFixture,
  authenticatedAuthorityPeer,
} from './socket-authority.test-support';

setupRitewayBun();
requireTestServices(process.env);

for (const change of ['revoked', 'expired', 'erased'] as const)
  test(`actual periodic authorization closes a ${change} durable session without an outbox event`, async () => {
    const fixture = await socketAuthorityFixture();
    try {
      const peer = await authenticatedAuthorityPeer(fixture);
      if (change === 'revoked')
        await fixture.client`delete from session where id=${fixture.sessionId}`;
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
