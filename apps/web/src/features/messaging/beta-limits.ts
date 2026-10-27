import { createAppError } from '@daisy/errors';
import {
  createMessagingCoreSchemas,
  createMessagingSocialSchemas,
  messagingBetaLimits,
  type MessagingCoreBounds,
  type MessagingSocialBounds,
} from '@daisy/protocol';

type MessagingPolicyLimits = {
  readonly bounds: MessagingCoreBounds;
  readonly maxBodyBytes: number;
  readonly social?: { readonly bounds: MessagingSocialBounds } | undefined;
};

/**
 * DEC-124: a runtime messaging policy may be tighter than the beta limits,
 * never looser. The app refuses one that is looser before any route uses it.
 */
export function parseMessagingPolicyLimits<
  Policy extends MessagingPolicyLimits,
>(policy: Policy): Policy {
  try {
    createMessagingCoreSchemas(policy.bounds);
    if (policy.social) createMessagingSocialSchemas(policy.social.bounds);
  } catch (cause) {
    throw createAppError('VALIDATION', undefined, cause);
  }
  if (
    !Number.isInteger(policy.maxBodyBytes) ||
    policy.maxBodyBytes < 1 ||
    policy.maxBodyBytes > messagingBetaLimits.bodyBytes
  )
    throw createAppError('VALIDATION');
  return policy;
}
