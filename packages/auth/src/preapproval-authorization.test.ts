import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from './authorization';
import type { AuthorizationCapability } from '@daisy/protocol/authorization';
setupRitewayBun();

test('email preapproval capabilities belong only to explicitly scoped operator services', () => {
  const capabilities = [
    'beta.preapproval.read',
    'beta.preapproval.update',
  ] as const;
  const service = (scopes: readonly AuthorizationCapability[]) => ({
    kind: 'operator_service' as const,
    serviceId: 'daisy-admin',
    keyId: 'admin1',
    operatorRef: 'o'.repeat(24),
    capabilities: scopes,
  });
  const decide = (
    capability: (typeof capabilities)[number],
    principal: Parameters<typeof authorize>[0]['principal'],
  ) =>
    authorize({
      principal,
      capability,
      resource: { kind: 'account_collection' },
      context: { account: null },
    }).allow;
  assert({
    given: 'a scoped operator service, unscoped service and participant',
    should: 'authorize only the scoped operator for both listing and mutation',
    actual: capabilities.map((capability) => [
      decide(capability, service([capability])),
      decide(capability, service([])),
      decide(capability, {
        kind: 'user',
        userId: 'u'.repeat(24),
        actorId: 'a'.repeat(24),
      }),
    ]),
    expected: [
      [true, false, false],
      [true, false, false],
    ],
  });
});
