import type { CheckedDeviceRead } from '../video/device-selection';
import { z } from 'zod';

const sourceErrorName = z.enum([
  'NotAllowedError',
  'SecurityError',
  'NotFoundError',
  'OverconstrainedError',
  'NotReadableError',
]);
export type DeviceFailureKind = 'permission' | 'absence' | 'failure';
export type PreferenceFailureKind =
  'preference-unreadable' | 'preference-invalid';
export type SourceFailureKind = DeviceFailureKind | PreferenceFailureKind;
export type SourceFailure = {
  readonly kind: SourceFailureKind;
};
const kinds: Record<z.infer<typeof sourceErrorName>, DeviceFailureKind> = {
  NotAllowedError: 'permission',
  SecurityError: 'permission',
  NotFoundError: 'absence',
  OverconstrainedError: 'absence',
  NotReadableError: 'failure',
};

/** SDK boundary: closed display-only facts, never authorization or retry authority. */
export function sourceFailureOf(error: unknown): {
  readonly kind: DeviceFailureKind;
} {
  const parsed = sourceErrorName.safeParse(
    typeof error === 'object' && error !== null && 'name' in error
      ? error.name
      : null,
  );
  return parsed.success ? { kind: kinds[parsed.data] } : { kind: 'failure' };
}

/** A typed preference failure is separate from SDK permission or missing hardware. */
export const preferenceFailureOf = (
  reason: Extract<CheckedDeviceRead, { state: 'unavailable' }>['reason'],
): SourceFailure => ({
  kind:
    reason === 'unreadable' ? 'preference-unreadable' : 'preference-invalid',
});
