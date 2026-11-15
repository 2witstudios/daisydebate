import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

test('DEC421 refuses every resource boundary before build admission', () => {
  const script = `
import json, sys
sys.path.insert(0, 'packages/media/integration/native-owner-compile')
from policy import refusal, LIMITS
base = dict(scratch=0, free=LIMITS['free'], available=LIMITS['available'], rss=LIMITS['rss'], now=0, deadline=1)
cases = [base, dict(base, free=base['free']-1), dict(base, available=base['available']-1), dict(base, scratch=LIMITS['scratch']+1), dict(base, rss=base['rss']+1), dict(base, now=1), dict(base, rss=None)]
print(json.dumps([refusal(x) for x in cases]))
`;
  const result = Bun.spawnSync(['python3', '-B', '-c', script]);
  assert({
    given:
      'threshold equality followed by disk, memory, scratch, RSS, deadline and missing-data violations',
    should: 'admit equality and refuse each violation with its explicit reason',
    actual: {
      exit: result.exitCode,
      decisions: JSON.parse(result.stdout.toString()) as unknown,
    },
    expected: {
      exit: 0,
      decisions: [
        null,
        'free-disk',
        'available-memory',
        'scratch-cap',
        'aggregate-rss',
        'deadline',
        'invalid-sample',
      ],
    },
  });
});

test('DEC421 reserves regression and cleanup time within the existing twenty-minute job', async () => {
  const { compileWindowSeconds } =
    await import('../packages/media/integration/native-owner-compile.test-support');
  const start = 1000000;
  assert({
    given: 'a fresh job and one already five minutes old',
    should: 'reserve six minutes and never promise the thirty-minute ceiling',
    actual: [
      compileWindowSeconds(start, start),
      compileWindowSeconds(start, start + 300000),
    ],
    expected: [840, 540],
  });
});
