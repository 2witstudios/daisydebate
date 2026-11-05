import type { FlagChange } from '@daisy/protocol/flags';
import type { FlagDefinition } from './model';

export type FlagChangeDecision =
  | { readonly kind: 'apply'; readonly revision: number }
  | { readonly kind: 'refused'; readonly reason: 'CONFLICT' | 'VALIDATION' };

/** The signed transport authenticates; this pure decision owns revision and expiry. */
export function decideFlagChange({
  entry,
  change,
  revision,
  expectedRevision,
  now,
}: {
  readonly entry: FlagDefinition;
  readonly change: FlagChange;
  readonly revision: number;
  readonly expectedRevision: number;
  readonly now: number;
}): FlagChangeDecision {
  if (revision !== expectedRevision || revision >= 2_147_483_647)
    return { kind: 'refused', reason: 'CONFLICT' };
  if (!Number.isFinite(now)) return { kind: 'refused', reason: 'VALIDATION' };
  const expiry = Date.parse(entry.expiresOn) + 86_400_000;
  if (change.action === 'flag.override.update') {
    if (!validOverride(entry, change.override, now, expiry))
      return { kind: 'refused', reason: 'VALIDATION' };
  } else if (
    entry.kind === 'release' &&
    change.state === 'enabled' &&
    now >= expiry
  )
    return { kind: 'refused', reason: 'VALIDATION' };
  return { kind: 'apply', revision: revision + 1 };
}

function validOverride(
  entry: FlagDefinition,
  override: Extract<FlagChange, { action: 'flag.override.update' }>['override'],
  now: number,
  expiry: number,
) {
  if (entry.kind !== 'release') return false;
  if (override === null) return true;
  const until = Date.parse(override.expiresAt);
  return Number.isFinite(until) && until > now && until <= expiry;
}
