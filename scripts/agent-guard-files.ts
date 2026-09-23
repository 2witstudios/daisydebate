/**
 * The agent guard's file rules (ADR 0035): loop state is changed only by the
 * loop commands, never by hand.
 */
import type { ShellCommand } from './shell-command';
import {
  allow,
  deny,
  LOOP_REASON,
  type GuardFacts,
  type Invocation,
  type Verdict,
} from './agent-guard-rules';

const LOOP_STATE = /ralph-loop\.(?:local|escalated)\.md/;
const fileMutators = new Set([
  'rm',
  'mv',
  'cp',
  'unlink',
  'truncate',
  'tee',
  'shred',
  'ln',
  'touch',
  'dd',
  'install',
]);

export const isLoopState = (path: string): boolean => LOOP_STATE.test(path);

export function loopState(
  command: ShellCommand,
  invocation: Invocation,
  facts: GuardFacts,
): Verdict {
  const [name = '', ...args] = invocation.words;
  const inPlace =
    (name === 'sed' || name === 'perl') &&
    args.some((arg) => /^-[A-Za-z]*i/.test(arg));
  const mutates =
    command.redirects.some(isLoopState) ||
    ((fileMutators.has(name) || inPlace) && args.some(isLoopState));
  return facts.autonomous && mutates ? deny(LOOP_REASON) : allow;
}
