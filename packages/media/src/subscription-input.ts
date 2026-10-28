import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

/** The admitted participant identities, validated at the trust boundary. */
export const identitiesOf = (values: readonly string[]) => {
  if (
    values.length > 508 ||
    values.some((value) => !idSchema.safeParse(value).success)
  )
    throw createAppError(
      'VALIDATION',
      'Invalid subscription participant scope',
    );
  return new Set(values);
};

/** A media endpoint and credential, validated before any native connect. */
export const validateConnection = (url: string, token: string) => {
  try {
    const parsed = new URL(url);
    if (
      !['ws:', 'wss:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error('Invalid endpoint');
  } catch {
    throw createAppError('VALIDATION', 'Invalid subscription endpoint');
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 16384)
    throw createAppError('VALIDATION', 'Invalid subscription credential');
};
