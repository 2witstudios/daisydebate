import { assert, setupRitewayBun, test } from 'riteway/bun';
import { api, signed } from './router.test-support';
setupRitewayBun();

test('signed preapproval commands validate and normalize the email before persistence', async () => {
  const { handle, calls } = api();
  const response = await handle(
    signed({
      method: 'PUT',
      path: '/operator/v1/beta-preapprovals',
      body: JSON.stringify({
        v: 1,
        commandId: 'c'.repeat(24),
        adminAuditHead: 'a'.repeat(64),
        operation: 'add',
        email: '  A.B+Beta@Example.Test  ',
        invite: false,
      }),
    }),
  );
  const input = calls.commands[0] as {
    command: { email: string };
    requestDigest: string;
  };
  assert({
    given: 'an owner service signature and a valid mixed-case email command',
    should:
      'admit normalized semantics and return the typed saved outcome without sending mail',
    actual: [
      response.status,
      input.command.email,
      /^[0-9a-f]{64}$/.test(input.requestDigest),
      (await response.json()).mail,
    ],
    expected: [200, 'a.b+beta@example.test', true, 'none'],
  });
});

test('preapproval routes fail closed without signature or with unknown body keys', async () => {
  const { handle, calls } = api();
  const unsigned = await handle(
    new Request('http://[fdaa::1]:8081/operator/v1/beta-preapprovals'),
  );
  const malformed = await handle(
    signed({
      method: 'PUT',
      path: '/operator/v1/beta-preapprovals',
      body: JSON.stringify({
        v: 1,
        commandId: 'c'.repeat(24),
        adminAuditHead: 'a'.repeat(64),
        operation: 'add',
        email: 'valid@example.test',
        invite: false,
        role: 'owner',
      }),
    }),
  );
  assert({
    given:
      'unsigned listing and a signed command carrying an extra authority field',
    should: 'refuse before any durable operation',
    actual: [unsigned.status, malformed.status, calls.commands.length],
    expected: [401, 400, 0],
  });
});
