/**
 * The admin app's one decision function (ADR 0077): pure, over the current
 * operator row, the action and the approval policy. The app authorizes here
 * before it signs anything; the participant app authorizes again on its own.
 */
export const operatorActions = [
  'accounts.read',
  'account.beta_access.update',
  'audit.read',
  'security.read',
] as const;
export type OperatorAction = (typeof operatorActions)[number];

export type OperatorFact = {
  readonly id: string;
  readonly role: 'owner' | 'operator';
  readonly disabled: boolean;
  readonly revision: number;
};

/** Two-person approval is designed in and switched off (`twoPerson: false`). */
export type ApprovalPolicy = {
  readonly twoPerson: boolean;
  readonly revision: number;
};

/** What a second approval must be bound to, exactly. */
export type ApprovalBinding = {
  readonly commandDigest: string;
  readonly targetRevision: number;
  readonly policyRevision: number;
  readonly approverId: string;
};

export type OperatorDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: 'disabled' | 'role' | 'approval_missing';
    };

const roleActions: Readonly<
  Record<OperatorFact['role'], readonly OperatorAction[]>
> = {
  owner: operatorActions,
  operator: [],
};

const mutatingActions: ReadonlySet<OperatorAction> = new Set([
  'account.beta_access.update',
]);

export const requiresSecondApproval = (
  policy: ApprovalPolicy,
  action: OperatorAction,
): boolean => policy.twoPerson && mutatingActions.has(action);

const approvalHolds = (
  operator: OperatorFact,
  policy: ApprovalPolicy,
  expected: Omit<ApprovalBinding, 'policyRevision' | 'approverId'>,
  evidence: ApprovalBinding | undefined,
): boolean =>
  evidence !== undefined &&
  evidence.commandDigest === expected.commandDigest &&
  evidence.targetRevision === expected.targetRevision &&
  evidence.policyRevision === policy.revision &&
  evidence.approverId !== operator.id;

export function authorizeOperator(input: {
  readonly operator: OperatorFact;
  readonly action: OperatorAction;
  readonly policy: ApprovalPolicy;
  /** The command an approval must name; absent for reads. */
  readonly command?: Omit<ApprovalBinding, 'policyRevision' | 'approverId'>;
  readonly approval?: ApprovalBinding;
}): OperatorDecision {
  const { operator, action, policy } = input;
  if (operator.disabled) return { allowed: false, reason: 'disabled' };
  if (!roleActions[operator.role].includes(action))
    return { allowed: false, reason: 'role' };
  if (
    requiresSecondApproval(policy, action) &&
    (input.command === undefined ||
      !approvalHolds(operator, policy, input.command, input.approval))
  )
    return { allowed: false, reason: 'approval_missing' };
  return { allowed: true };
}

/** Today's policy: no action needs a second approver. */
export const currentApprovalPolicy: ApprovalPolicy = {
  twoPerson: false,
  revision: 1,
};

/** The closed audit detail a denial is recorded under. */
export const deniedDetail = (
  reason: Extract<OperatorDecision, { allowed: false }>['reason'],
): 'operator_disabled' | 'role' | 'approval_missing' =>
  reason === 'disabled' ? 'operator_disabled' : reason;
