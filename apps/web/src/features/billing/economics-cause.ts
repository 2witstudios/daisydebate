import { isAppError } from '@daisy/errors';
import type { RefusalReason } from '@daisy/protocol';

/** At most this many links of a cause chain are read; a longer or cyclic chain is cut there. */
const chainBound = 8;

/** An own data property, never a getter, and never a throw (a Proxy trap included). */
function ownValue(object: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The errors of a cause chain, outermost first, read so it cannot throw: only
 * own data-property `cause` links, a cycle guard and a bound. A hostile error
 * (a throwing getter, a Proxy) simply ends the chain where it stops being
 * readable.
 */
export function causeChain(error: unknown): readonly Error[] {
  const chain: Error[] = [];
  const seen = new WeakSet<object>();
  let current = error;
  try {
    while (
      chain.length < chainBound &&
      current instanceof Error &&
      !seen.has(current)
    ) {
      seen.add(current);
      chain.push(current);
      current = ownValue(current, 'cause');
    }
  } catch {
    /* An unreadable link ends the chain. */
  }
  return chain;
}

/** The innermost closed refusal reason in a cause chain: the actual fault, not where it was met. */
export function innermostReason(error: unknown): RefusalReason | undefined {
  let reason: RefusalReason | undefined;
  for (const link of causeChain(error)) {
    const own = ownValue(link, 'reason');
    if (isAppError(link) && typeof own === 'string')
      reason = own as RefusalReason;
  }
  return reason;
}

/**
 * The closed system code of an untyped error: its `code` (an errno such as
 * ECONNREFUSED) and its `errno` (a SQLSTATE such as 55P03, which Bun SQL
 * carries there), read as own data properties.
 */
export function systemCodeOf(error: Error): string {
  const code = ownValue(error, 'code');
  const errno = ownValue(error, 'errno');
  return [code, errno]
    .filter((value): value is string => typeof value === 'string')
    .join('/');
}

/** An error's class name, or nothing if reading it throws. */
export function classNameOf(error: Error): string {
  try {
    return typeof error.name === 'string' ? error.name : '';
  } catch {
    return '';
  }
}
