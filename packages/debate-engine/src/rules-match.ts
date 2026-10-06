import { debateRoles, type FormatRules } from '@daisy/protocol';

/**
 * True when `rules` are exactly the canonical rules of the format (key order
 * ignored). A ranked debate must run under canonical rules (ADR 0030); a
 * lobby may override them, and then its result never reaches the ladder.
 */
export function rulesMatchFormat(
  rules: FormatRules,
  canonical: FormatRules,
): boolean {
  return (
    rules.version === canonical.version &&
    debateRoles.every((role) => rules.seats[role] === canonical.seats[role]) &&
    rules.clock.speechMs === canonical.clock.speechMs &&
    rules.clock.prepMs === canonical.clock.prepMs
  );
}
