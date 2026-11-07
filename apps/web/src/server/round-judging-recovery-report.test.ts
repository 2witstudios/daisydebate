import { assert, setupRitewayBun, test } from 'riteway/bun';
import { eventRegistry } from '@daisy/logger';
import { judgingRecoveryReasons } from '@daisy/protocol';
import { reportJudgingRecovery } from './round-judging-recovery-report';
setupRitewayBun();
test('pending judging reports distinguish recovery causes from terminal failure', () => {
  const lines: unknown[][] = [];
  for (const reason of judgingRecoveryReasons)
    reportJudgingRecovery(
      {
        log: (...line) => {
          lines.push(line);
        },
      },
      reason,
    );
  assert({
    given:
      'an attempt-window pause, provider refusal or exhausted automatic funding while the obligation remains durable',
    should:
      'report a separate warning with its closed recovery reason and no claim of ended judging',
    actual: { level: eventRegistry['round.judging.recovery_pending'], lines },
    expected: {
      level: 'warn',
      lines: judgingRecoveryReasons.map((cause) => [
        'round.judging.recovery_pending',
        { operation: 'round.judging.execute', cause },
        'Judging recovery remains pending',
      ]),
    },
  });
});
test('a failed recovery log sink cannot turn pending judging into a failed execution', () => {
  let threw = false;
  try {
    reportJudgingRecovery(
      {
        log: () => {
          throw new Error('Injected sink unavailable');
        },
      },
      'attempt_window',
    );
  } catch {
    threw = true;
  }
  assert({
    given: 'a throwing local log sink',
    should: 'leave recovery semantics untouched',
    actual: threw,
    expected: false,
  });
});
