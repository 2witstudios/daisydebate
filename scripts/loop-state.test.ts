import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  authorizeControl,
  escalateState,
  escalationMessage,
  parseReason,
  readIteration,
  resumeState,
} from './loop-state';

setupRitewayBun();

const active = [
  '---',
  'active: true',
  'iteration: 7',
  'session_id: s-1',
  'max_iterations: 40',
  'completion_promise: "CONVERGED"',
  'started_at: "2026-09-22T10:00:00Z"',
  '---',
  '',
  'Converge the PR.',
  '---',
  'A rule inside the prompt.',
  '',
].join('\n');

const escalation = {
  reason: 'stalled' as const,
  detail: 'Two identical scans: "CodeRabbit" rate-limited',
  sha: 'a'.repeat(40),
  at: '2026-09-22T11:00:00.000Z',
  child: 'ag-child',
  parent: 'ag-parent',
  pr: 57,
};

describe('parseReason', () => {
  test('accepts only the four escalation reasons', () => {
    assert({
      given: 'each allowed reason and an unknown one',
      should: 'return the reasons and reject the rest',
      actual: [
        parseReason('needs-owner'),
        parseReason('blocked'),
        parseReason('stalled'),
        parseReason('out-of-scope'),
        parseReason('done'),
      ],
      expected: [
        'needs-owner',
        'blocked',
        'stalled',
        'out-of-scope',
        undefined,
      ],
    });
  });
});

describe('escalateState and resumeState', () => {
  const escalated = escalateState(active, escalation);

  test('pauses without ending: prompt, session and iteration are kept', () => {
    assert({
      given: 'an active loop state escalated as stalled',
      should: 'keep the iteration and prompt and record the escalation',
      actual: [
        readIteration(escalated),
        escalated.includes('Converge the PR.\n---\nA rule inside the prompt.'),
        escalated.includes('session_id: s-1'),
        escalated.includes('escalation_reason: stalled'),
        escalated.includes(`escalated_sha: ${'a'.repeat(40)}`),
        escalated.includes('escalated_at: "2026-09-22T11:00:00.000Z"'),
        escalated.includes('escalation_parent: ag-parent'),
      ],
      expected: [7, true, true, true, true, true, true],
    });
  });

  test('quotes the detail so it cannot break the frontmatter', () => {
    assert({
      given: 'a detail containing quotes and a frontmatter fence',
      should: 'store it as one JSON-quoted line',
      actual: escalateState(active, {
        ...escalation,
        detail: 'x\n---\ny "z"',
      }).includes('escalation_detail: "x\\n---\\ny \\"z\\""'),
      expected: true,
    });
  });

  test('resumes to exactly the state that was paused', () => {
    assert({
      given: 'an escalated state',
      should: 'restore the original active state byte for byte',
      actual: resumeState(escalated),
      expected: active,
    });
  });

  test('refuses to escalate something that is not a loop state', () => {
    assert({
      given: 'text without frontmatter',
      should: 'throw',
      actual: (() => {
        try {
          escalateState('no frontmatter', escalation);
          return 'accepted';
        } catch (error) {
          return (error as Error).message;
        }
      })(),
      expected: 'Not a loop state file: no frontmatter found',
    });
  });
});

describe('authorizeControl', () => {
  test('lets the recorded parent or the owner close or resume a loop', () => {
    assert({
      given: 'the parent agent, and an owner session',
      should: 'authorize both',
      actual: [
        authorizeControl({
          autonomous: true,
          caller: 'ag-parent',
          parent: 'ag-parent',
          child: 'ag-child',
        }),
        authorizeControl({
          autonomous: false,
          caller: undefined,
          parent: 'ag-parent',
          child: 'ag-child',
        }),
      ],
      expected: [undefined, undefined],
    });
  });

  test('refuses the loop agent itself and any other agent', () => {
    assert({
      given:
        'the child, an unrelated agent, and an agent when no parent is recorded',
      should: 'refuse each with a reason',
      actual: [
        authorizeControl({
          autonomous: true,
          caller: 'ag-child',
          parent: 'ag-parent',
          child: 'ag-child',
        }),
        authorizeControl({
          autonomous: true,
          caller: 'ag-other',
          parent: 'ag-parent',
          child: 'ag-child',
        }),
        authorizeControl({
          autonomous: true,
          caller: 'ag-other',
          parent: undefined,
          child: 'ag-child',
        }),
        authorizeControl({
          autonomous: true,
          caller: undefined,
          parent: 'ag-parent',
          child: 'ag-child',
        }),
      ],
      expected: [
        'A loop agent cannot close or resume its own loop; only its parent (ag-parent) or the owner can.',
        'Only the parent (ag-parent) or the owner can close or resume this loop.',
        'No parent is recorded for this loop, so only the owner can close or resume it.',
        'Only the parent (ag-parent) or the owner can close or resume this loop.',
      ],
    });
  });
});

describe('escalationMessage', () => {
  test('carries the reason, context and exact close and resume commands', () => {
    assert({
      given: 'an escalation',
      should: 'give the parent everything needed to decide',
      actual: escalationMessage({ ...escalation, iteration: 7 }),
      expected:
        '[loop] ag-child escalated stalled at iteration 7 (PR #57, aaaaaaa): Two identical scans: "CodeRabbit" rate-limited. Close: bun loop:close ag-child "<why>" · Resume: bun loop:resume ag-child "<instructions>"',
    });
  });
});
