import type { CheckedDeviceRead } from '../video/device-selection';
import { z } from 'zod';

const sourceErrorName = z.enum([
  'NotAllowedError',
  'SecurityError',
  'NotFoundError',
  'OverconstrainedError',
  'NotReadableError',
]);
export type SourceFailureKind =
  | 'permission'
  | 'absence'
  | 'failure'
  | 'preference-unreadable'
  | 'preference-invalid';
export type SourceFailure = {
  readonly name: z.infer<typeof sourceErrorName> | 'UnknownError';
  readonly kind: SourceFailureKind;
};
const kinds: Record<z.infer<typeof sourceErrorName>, SourceFailureKind> = {
  NotAllowedError: 'permission',
  SecurityError: 'permission',
  NotFoundError: 'absence',
  OverconstrainedError: 'absence',
  NotReadableError: 'failure',
};

/** SDK boundary: closed display-only facts, never authorization or retry authority. */
export function sourceFailureOf(error: unknown): SourceFailure {
  const parsed = sourceErrorName.safeParse(
    typeof error === 'object' && error !== null && 'name' in error
      ? error.name
      : null,
  );
  return parsed.success
    ? { name: parsed.data, kind: kinds[parsed.data] }
    : { name: 'UnknownError', kind: 'failure' };
}

/** A typed preference failure is separate from SDK permission or missing hardware. */
export const preferenceFailureOf = (
  reason: Extract<CheckedDeviceRead, { state: 'unavailable' }>['reason'],
): SourceFailure => ({
  name: 'UnknownError',
  kind:
    reason === 'unreadable' ? 'preference-unreadable' : 'preference-invalid',
});
