/**
 * The agent guard's gh rules (ADR 0035): direct merges, and rule, protection
 * and settings mutations through the GitHub CLI and API.
 */
import {
  allow,
  autonomousOnly,
  combine,
  MERGE_REASON,
  refuseOrAsk,
  RULE_REASON,
  splitFlag,
  type GuardFacts,
  type Rule,
  type Verdict,
} from './agent-guard-rules';

const apiValueOptions = new Set([
  '-X',
  '--method',
  '-H',
  '--header',
  '-f',
  '-F',
  '--field',
  '--raw-field',
  '--input',
  '-q',
  '--jq',
  '-t',
  '--template',
  '--hostname',
  '--cache',
  '-p',
  '--preview',
]);
const bodyOptions = new Set(['-f', '-F', '--field', '--raw-field', '--input']);
const MERGE_MUTATIONS = /\b(?:mergePullRequest|mergeBranch)\b/;
const RULE_MUTATIONS =
  /\b(?:(?:create|update|delete)BranchProtectionRule|(?:create|update|delete)RepositoryRuleset|updateRepository)\b/;
const RULE_ENDPOINTS = [
  /(?:^|\/)rulesets(?:\/|$)/,
  /\/branches\/[^/]+\/protection/,
  /^repos\/[^/]+\/[^/]+\/?$/,
  /\/git\/refs\/heads\//,
];

type ApiCall = { method: string; endpoint: string };

function parseApiCall(args: readonly string[]): ApiCall {
  let method: string | undefined;
  let hasBody = false;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inline] = splitFlag(arg);
    const takesValue = arg.startsWith('-') && apiValueOptions.has(flag);
    if (!arg.startsWith('-')) positional.push(arg);
    if (flag === '-X' || flag === '--method')
      method = (inline ?? args[index + 1] ?? '').toUpperCase();
    hasBody ||= takesValue && bodyOptions.has(flag);
    if (takesValue && inline === undefined) index += 1;
  }
  return {
    method: method ?? (hasBody ? 'POST' : 'GET'),
    endpoint: (positional[0] ?? '').replace(/^\//, ''),
  };
}

function ghApi(args: readonly string[], facts: GuardFacts): Verdict {
  const { method, endpoint } = parseApiCall(args);
  const text = args.join(' ');
  if (endpoint === 'graphql')
    return combine([
      MERGE_MUTATIONS.test(text) ? refuseOrAsk(facts, MERGE_REASON) : allow,
      RULE_MUTATIONS.test(text) ? autonomousOnly(facts, RULE_REASON) : allow,
    ]);
  if (method === 'GET' || method === 'HEAD') return allow;
  if (/\/pulls\/\d+\/merge\/?(?:\?.*)?$/.test(endpoint))
    return refuseOrAsk(facts, MERGE_REASON);
  return RULE_ENDPOINTS.some((pattern) => pattern.test(endpoint))
    ? autonomousOnly(facts, RULE_REASON)
    : allow;
}

// Flags of gh pr (and pr merge) that take a value; the value is never a flag.
const PR_VALUE_FLAGS = new Set([
  '-R',
  '--repo',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-t',
  '--subject',
  '--match-head-commit',
  '-A',
  '--author-email',
]);

/** The subcommand of gh pr and the boolean flags given, values skipped. */
function prCommand(args: readonly string[]) {
  const flags = new Map<string, string>();
  let action: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const [flag, inline] = splitFlag(args[index]);
    if (!args[index].startsWith('-')) action ??= args[index];
    else if (PR_VALUE_FLAGS.has(flag)) index += inline === undefined ? 1 : 0;
    else flags.set(flag, inline ?? 'true');
  }
  return { action, flags };
}

export const gh: Rule = (invocation, facts) => {
  const [, group, action, ...args] = invocation.words;
  if (group === 'api') return ghApi([action ?? '', ...args], facts);
  if (group === 'repo' && action === 'edit')
    return autonomousOnly(facts, RULE_REASON);
  if (group !== 'pr') return allow;
  const pr = prCommand([action ?? '', ...args]);
  if (pr.action !== 'merge') return allow;
  if (pr.flags.has('--admin'))
    return refuseOrAsk(
      facts,
      `--admin bypasses the main ruleset. ${MERGE_REASON}`,
    );
  return pr.flags.get('--auto') === 'true'
    ? allow
    : refuseOrAsk(facts, MERGE_REASON);
};
