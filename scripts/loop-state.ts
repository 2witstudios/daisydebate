/**
 * Pure state transitions for PR loops (ADR 0035). The Ralph loop plugin's
 * stop hook keys only on `.claude/ralph-loop.local.md` existing, so moving
 * that file aside pauses a loop without ending it. An escalation appends its
 * own keys to the frontmatter; resuming removes exactly those keys, so the
 * prompt, session and iteration come back byte for byte.
 */

export const REASONS = [
  'needs-owner',
  'blocked',
  'stalled',
  'out-of-scope',
] as const;
export type Reason = (typeof REASONS)[number];

export const parseReason = (value: string): Reason | undefined =>
  REASONS.find((reason) => reason === value);

export type Escalation = {
  readonly reason: Reason;
  readonly detail: string;
  readonly sha: string;
  /** UTC ISO timestamp. */
  readonly at: string;
  readonly child: string;
  /** Recorded parent agent; undefined means the owner. */
  readonly parent: string | undefined;
  readonly pr: number | undefined;
};

const ESCALATION_KEY = /^escalat(?:ion|ed)_[a-z_]+:/;

function splitFrontmatter(text: string): {
  readonly keys: readonly string[];
  readonly body: string;
} {
  const lines = text.split('\n');
  const close = lines.indexOf('---', 1);
  if (lines[0] !== '---' || close === -1)
    throw new Error('Not a loop state file: no frontmatter found');
  return {
    keys: lines.slice(1, close),
    body: lines.slice(close + 1).join('\n'),
  };
}

const joinFrontmatter = (keys: readonly string[], body: string): string =>
  ['---', ...keys, '---', body].join('\n');

export function readIteration(text: string): number | undefined {
  const line = splitFrontmatter(text).keys.find((key) =>
    key.startsWith('iteration:'),
  );
  const value = Number(line?.slice('iteration:'.length).trim());
  return Number.isInteger(value) ? value : undefined;
}

export function escalateState(text: string, escalation: Escalation): string {
  const { keys, body } = splitFrontmatter(text);
  return joinFrontmatter(
    [
      ...keys,
      `escalation_reason: ${escalation.reason}`,
      `escalation_detail: ${JSON.stringify(escalation.detail)}`,
      `escalation_child: ${escalation.child}`,
      `escalation_parent: ${escalation.parent ?? 'owner'}`,
      `escalated_iteration: ${readIteration(text) ?? 'unknown'}`,
      `escalated_sha: ${escalation.sha}`,
      `escalated_at: ${JSON.stringify(escalation.at)}`,
    ],
    body,
  );
}

export function resumeState(text: string): string {
  const { keys, body } = splitFrontmatter(text);
  return joinFrontmatter(
    keys.filter((key) => !ESCALATION_KEY.test(key)),
    body,
  );
}

/** Reads one recorded escalation value back, e.g. `reason` or `parent`. */
export function escalationField(
  text: string,
  field: string,
): string | undefined {
  const prefix = `escalation_${field}:`;
  const line = splitFrontmatter(text).keys.find((key) =>
    key.startsWith(prefix),
  );
  return line?.slice(prefix.length).trim();
}

/**
 * Who may close or resume a paused loop: undefined when allowed, otherwise
 * why not. The caller is PU_AGENT_ID, which
 * the guard stops an agent clearing; no agent id at all is the owner. The
 * parent comes from the registry agent:spawn wrote outside the child's
 * worktree, so the child cannot name itself or a sibling as its parent.
 */
export function authorizeControl(input: {
  readonly caller: string | undefined;
  readonly parent: string | undefined;
  readonly child: string;
}): string | undefined {
  if (input.caller === undefined) return undefined;
  if (input.parent === undefined)
    return 'No parent is recorded for this loop, so only the owner can close or resume it.';
  if (input.caller === input.child)
    return `A loop agent cannot close or resume its own loop; only its parent (${input.parent}) or the owner can.`;
  return input.caller === input.parent
    ? undefined
    : `Only the parent (${input.parent}) or the owner can close or resume this loop.`;
}

export function escalationMessage(
  input: Escalation & { readonly iteration: number | undefined },
): string {
  const where = [
    input.pr === undefined ? 'no PR' : `PR #${input.pr}`,
    input.sha.slice(0, 7),
  ].join(', ');
  return `[loop] ${input.child} escalated ${input.reason} at iteration ${input.iteration ?? '?'} (${where}): ${input.detail}. Close: bun loop:close ${input.child} "<why>" · Resume: bun loop:resume ${input.child} "<instructions>"`;
}
