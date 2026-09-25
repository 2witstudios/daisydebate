/**
 * The agent guard's deploy rule (ADR 0035 amendment, 2026-09-25). fly and
 * flyctl reach production and staging infrastructure directly, and AGENTS.md
 * requires a human-only sign-off leaf for deploy-rail and production-data
 * changes. So an autonomous agent never runs fly or flyctl, whatever the
 * subcommand: this is a full refusal, not a subcommand allowlist, because no
 * autonomous use of the tool is legitimate.
 */
import { autonomousOnly, type Rule } from './agent-guard-rules';

export const FLY_REASON =
  'Deploy-rail and production-data changes need a human-only sign-off leaf (AGENTS.md); an autonomous agent never runs fly or flyctl.';

export const fly: Rule = (_invocation, facts) =>
  autonomousOnly(facts, FLY_REASON);
