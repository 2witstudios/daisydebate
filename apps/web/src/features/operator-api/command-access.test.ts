import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { AuthorizationCapability } from '@daisy/protocol/authorization';
import { mayReadOperatorCommand } from './command-access';
setupRitewayBun();

test('command readback requires the exact resource scope', () => {
  const scopes = [
    'account.collection.read',
    'beta.preapproval.read',
    'flag.command.read',
  ] as const;
  const principal = (capability: AuthorizationCapability) => ({
    kind: 'operator_service' as const,
    serviceId: 'daisy-admin',
    operatorRef: 'o'.repeat(24),
    keyId: 'admin1',
    capabilities: [capability],
  });
  assert({
    given: 'services scoped only to accounts, preapprovals or flags',
    should: 'read only their corresponding command receipts',
    actual: scopes.map((scope) =>
      [
        'account.beta_access.update',
        'beta.preapproval.update',
        'flag.state.update',
      ].map((action) =>
        mayReadOperatorCommand(
          principal(scope),
          action as Parameters<typeof mayReadOperatorCommand>[1],
        ),
      ),
    ),
    expected: [
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ],
  });
});
