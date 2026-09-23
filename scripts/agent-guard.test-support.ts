import { classifyCommand } from './agent-guard';
import type { GuardFacts } from './agent-guard-rules';

export const worktree = '/repo/.pu/worktrees/wt-mine';
export const other = '/repo/.pu/worktrees/wt-other';
export const main = '/repo';

export const facts = (overrides: Partial<GuardFacts> = {}): GuardFacts => ({
  autonomous: true,
  worktree,
  cwd: worktree,
  protectedBranches: ['main'],
  branchOf: (dir) => (dir === worktree ? 'pu/mine' : 'main'),
  stackOf: (dir) =>
    dir.startsWith(worktree)
      ? 'daisy-mine'
      : dir.startsWith(other)
        ? 'daisy-other'
        : 'daisy',
  databaseOf: (dir) =>
    dir.startsWith(worktree) ? 'daisy_wt_mine' : dir === main ? 'daisy' : 'x',
  mainCheckout: main,
  processCwd: (pid) =>
    pid === 101 ? `${worktree}/apps/web` : pid === 202 ? other : undefined,
  ...overrides,
});

export const owner = (overrides: Partial<GuardFacts> = {}) =>
  facts({ autonomous: false, ...overrides });

export const decide = (command: string, context: GuardFacts = facts()) =>
  classifyCommand(command, context).decision;
