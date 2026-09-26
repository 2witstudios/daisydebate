/**
 * The agent guard's deploy rule (ADR 0035 amendment, 2026-09-25, refined
 * after the PR #113 review). fly and flyctl reach production and staging
 * infrastructure directly, and AGENTS.md requires a human-only sign-off leaf
 * for deploy-rail and production-data changes. So an autonomous agent may
 * only run the read-only diagnostics this file allowlists (`fly logs`,
 * `fly status`, `fly apps list`, …, the shape `scripts/staging-security-
 * probe.ts` (AUTH-7.8) already depends on); every other subcommand,
 * including one this file does not recognize, is refused.
 */
import {
  allow,
  autonomousOnly,
  splitFlag,
  type Rule,
} from './agent-guard-rules';

const FLY_REASON =
  'Deploy-rail and production-data changes need a human-only sign-off leaf (AGENTS.md); an autonomous agent may only run read-only fly/flyctl diagnostics (logs, status, list, show, whoami, validate).';

// fly's own per-command flags that take a value; -a/-c/-t can appear before
// or after the subcommand, so they are skipped wherever they occur.
const FLY_VALUE_OPTIONS = new Set([
  '-a',
  '--app',
  '-c',
  '--config',
  '-t',
  '--access-token',
  '--org',
]);

// A bare read-only command, whatever its group.
const FLY_READ_ONLY = new Set(['logs', 'status', 'version', 'doctor']);
// group -> the actions of that group that only read.
const FLY_READ_ONLY_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  apps: new Set(['list']),
  machines: new Set(['list', 'status']),
  secrets: new Set(['list']),
  releases: new Set(['list']),
  checks: new Set(['list']),
  config: new Set(['show', 'validate']),
  auth: new Set(['whoami']),
};

/** fly/flyctl's positional words, its own value-flags skipped wherever they fall. */
function flyPositionals(words: readonly string[]): readonly string[] {
  const positionals: string[] = [];
  const rest = words.slice(1);
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index];
    if (!word.startsWith('-')) {
      positionals.push(word);
      continue;
    }
    const [flag, inline] = splitFlag(word);
    if (FLY_VALUE_OPTIONS.has(flag) && inline === undefined) index += 1;
  }
  return positionals;
}

export const fly: Rule = (invocation, facts) => {
  if (!facts.autonomous) return allow;
  const [group, action] = flyPositionals(invocation.words);
  const readOnly =
    FLY_READ_ONLY.has(group ?? '') ||
    (FLY_READ_ONLY_ACTIONS[group ?? '']?.has(action ?? '') ?? false);
  return readOnly ? allow : autonomousOnly(facts, FLY_REASON);
};
