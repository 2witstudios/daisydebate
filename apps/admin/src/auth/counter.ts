/**
 * The sign counter rule (ADR 0077). A synced (backed-up) passkey may report
 * 0 forever and shares its counter across devices, so only a device-bound
 * credential is held to a strictly increasing counter; a counter that does
 * not advance there signals a cloned authenticator and is refused.
 */
export function counterAccepted(input: {
  readonly stored: number;
  readonly received: number;
  readonly backedUp: boolean;
}): boolean {
  if (input.backedUp) return true;
  if (input.stored === 0 && input.received === 0) return true;
  return input.received > input.stored;
}
