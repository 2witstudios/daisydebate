import { assert, setupRitewayBun, test } from 'riteway/bun';
import { api, signed } from './router.test-support';
import { mayControlFlags } from './flags';

setupRitewayBun();
const path = '/operator/v1/flags/premium-checkout/state';
const command = {
  v: 1,
  commandId: 'c'.repeat(24),
  expectedRevision: 0,
  adminAuditHead: 'a'.repeat(64),
  state: 'enabled',
};

test('flag changes require a signed private operator request and closed body', async () => {
  const { handle, calls } = api();
  const response = await handle(
    signed({ method: 'PUT', path, body: JSON.stringify(command) }),
  );
  const ordinary = await handle(
    new Request(`https://internal.test${path}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: 'session=participant',
      },
      body: JSON.stringify(command),
    }),
  );
  const injected = await handle(
    signed({
      method: 'PUT',
      path,
      body: JSON.stringify({ ...command, capabilities: ['flag.state.update'] }),
    }),
  );
  const validRequest = signed({
    method: 'PUT',
    path,
    body: JSON.stringify(command),
  });
  const queryOverride = await handle(
    new Request(`${validRequest.url}?ft=premium-checkout`, validRequest),
  );
  assert({
    given:
      'signed change, participant cookie, injected capability and client query override',
    should: 'accept only the closed signed command',
    actual: [
      response.status,
      ordinary.status,
      injected.status,
      queryOverride.status,
      calls.commands.length,
    ],
    expected: [200, 401, 400, 401, 1],
  });
});

test('target selection cannot confer operator capabilities', () => {
  assert({
    given:
      'anonymous, participant, foundation service and operator lacking the flag capability',
    should: 'deny every flag write',
    actual: [
      mayControlFlags({ kind: 'anonymous' }, 'flag.state.update'),
      mayControlFlags(
        { kind: 'user', userId: 'u'.repeat(24), actorId: 'a'.repeat(24) },
        'flag.override.update',
      ),
      mayControlFlags(
        {
          kind: 'operator_service',
          serviceId: 'daisy-admin',
          keyId: 'test',
          operatorRef: 'o'.repeat(24),
          capabilities: ['account.beta_access.update'],
        },
        'flag.state.update',
      ),
    ],
    expected: [false, false, false],
  });
});
