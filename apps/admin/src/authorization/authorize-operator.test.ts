import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  authorizeOperator,
  currentApprovalPolicy,
  operatorActions,
  requiresSecondApproval,
  type ApprovalBinding,
  type OperatorFact,
} from './authorize-operator';

setupRitewayBun();
const owner: OperatorFact = {
  id: 'o1',
  role: 'owner',
  disabled: false,
  revision: 1,
};
const twoPerson = { twoPerson: true, revision: 3 };
const command = { commandDigest: 'd'.repeat(64), targetRevision: 7 };
const approval: ApprovalBinding = {
  ...command,
  policyRevision: 3,
  approverId: 'o2',
};
const update = 'account.beta_access.update' as const;

test('authorizeOperator: roles', () => {
  const decide = (operator: OperatorFact) =>
    operatorActions.map(
      (action) =>
        authorizeOperator({ operator, action, policy: currentApprovalPolicy })
          .allowed,
    );
  assert({
    given: 'an enabled owner',
    should: 'hold every action',
    actual: decide(owner),
    expected: [true, true, true],
  });
  assert({
    given: 'the operator role, designed in with no actions yet',
    should: 'be denied every action',
    actual: decide({ ...owner, role: 'operator' }),
    expected: [false, false, false],
  });
  assert({
    given: 'a disabled owner',
    should: 'be denied with the reason',
    actual: authorizeOperator({
      operator: { ...owner, disabled: true },
      action: 'audit.read',
      policy: currentApprovalPolicy,
    }),
    expected: { allowed: false, reason: 'disabled' },
  });
});

test('requiresSecondApproval', () => {
  assert({
    given: "today's policy",
    should: 'require no second approval for any action',
    actual: operatorActions.map((action) =>
      requiresSecondApproval(currentApprovalPolicy, action),
    ),
    expected: [false, false, false],
  });
  assert({
    given: 'two-person approval switched on',
    should: 'require it only for the mutating action',
    actual: operatorActions.map((action) =>
      requiresSecondApproval(twoPerson, action),
    ),
    expected: [false, true, false],
  });
});

test('authorizeOperator: approval fails closed', () => {
  const decide = (evidence?: ApprovalBinding) =>
    authorizeOperator({
      operator: owner,
      action: update,
      policy: twoPerson,
      command,
      ...(evidence === undefined ? {} : { approval: evidence }),
    });
  const denied = { allowed: false, reason: 'approval_missing' } as const;
  assert({
    given: 'a required approval bound to this command by another operator',
    should: 'allow',
    actual: decide(approval),
    expected: { allowed: true },
  });
  assert({
    given:
      'missing evidence, or evidence for another digest, revision, policy or by the actor',
    should: 'deny every one',
    actual: [
      decide(),
      decide({ ...approval, commandDigest: 'e'.repeat(64) }),
      decide({ ...approval, targetRevision: 8 }),
      decide({ ...approval, policyRevision: 2 }),
      decide({ ...approval, approverId: owner.id }),
    ],
    expected: [denied, denied, denied, denied, denied],
  });
  assert({
    given: 'a required approval with no command to bind it to',
    should: 'deny',
    actual: authorizeOperator({
      operator: owner,
      action: update,
      policy: twoPerson,
      approval,
    }),
    expected: denied,
  });
});
