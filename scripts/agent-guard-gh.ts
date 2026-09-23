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

type ApiCall = {
  method: string;
  endpoint: string;
  fields: Readonly<Record<string, string>>;
  input: boolean;
};

type Draft = {
  method?: string;
  hasBody: boolean;
  input: boolean;
  fields: Record<string, string>;
  positional: string[];
};

/** Reads one argument of gh api; returns how many words it used. */
function readApiArg(draft: Draft, arg: string, next: string | undefined) {
  if (!arg.startsWith('-')) {
    draft.positional.push(arg);
    return 1;
  }
  const [flag, inline] = splitFlag(arg);
  const value = inline ?? next ?? '';
  if (flag === '-X' || flag === '--method') draft.method = value.toUpperCase();
  if (bodyOptions.has(flag)) {
    draft.hasBody = true;
    draft.input ||= flag === '--input';
    const at = value.indexOf('=');
    if (flag !== '--input')
      draft.fields[value.slice(0, at)] = value.slice(at + 1);
  }
  return apiValueOptions.has(flag) && inline === undefined ? 2 : 1;
}

function parseApiCall(args: readonly string[]): ApiCall {
  const draft: Draft = {
    hasBody: false,
    input: false,
    fields: {},
    positional: [],
  };
  for (let index = 0; index < args.length;)
    index += readApiArg(draft, args[index], args[index + 1]);
  return {
    method: draft.method ?? (draft.hasBody ? 'POST' : 'GET'),
    endpoint: (draft.positional[0] ?? '')
      .replace(/^\//, '')
      .replace(/\?.*$/, ''),
    fields: draft.fields,
    input: draft.input,
  };
}

const REF_MUTATIONS =
  /\b(?:updateRefs?|createRef|deleteRef|createCommitOnBranch)\b/;
const REF_REASON =
  'Writing a branch through the API bypasses the pre-push guard; push your branch with git and request the merge with `gh pr merge --auto --merge`.';

function graphql(call: ApiCall, text: string, facts: GuardFacts): Verdict {
  // A query read from a file or stdin cannot be inspected.
  const opaque =
    call.input || Object.values(call.fields).some((v) => v.startsWith('@'));
  return combine([
    MERGE_MUTATIONS.test(text) ? refuseOrAsk(facts, MERGE_REASON) : allow,
    RULE_MUTATIONS.test(text) ? autonomousOnly(facts, RULE_REASON) : allow,
    REF_MUTATIONS.test(text) || opaque
      ? autonomousOnly(facts, REF_REASON)
      : allow,
  ]);
}

/** Contents writes land on the default branch unless a branch is named. */
const writesMainContents = (call: ApiCall): boolean =>
  /^repos\/[^/]+\/[^/]+\/contents(?:\/|$)/.test(call.endpoint) &&
  (call.fields.branch === undefined || call.fields.branch === 'main');

function ghApi(args: readonly string[], facts: GuardFacts): Verdict {
  const call = parseApiCall(args);
  if (call.endpoint === 'graphql') return graphql(call, args.join(' '), facts);
  if (call.method === 'GET' || call.method === 'HEAD') return allow;
  if (/\/pulls\/\d+\/merge\/?$/.test(call.endpoint))
    return refuseOrAsk(facts, MERGE_REASON);
  if (
    writesMainContents(call) ||
    /^repos\/[^/]+\/[^/]+\/merges\/?$/.test(call.endpoint)
  )
    return autonomousOnly(facts, REF_REASON);
  return RULE_ENDPOINTS.some((pattern) => pattern.test(call.endpoint))
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
