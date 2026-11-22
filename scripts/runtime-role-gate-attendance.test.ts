import { readFileSync } from 'node:fs';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { findRuntimeRoleGateProblem } from './runtime-role-gate';
import { realStart } from './runtime-role-gate.test-support';
setupRitewayBun();

const receiptModule = 'apps/web/src/features/attendance/receipt-session.ts';

test('the actual startup graph admits receipt preparation but still refuses startup bypasses in the Attendance module', () => {
  assert({
    given: 'the committed start.ts and its real Attendance receipt module',
    should: 'pass the actual startup gate with no waiver',
    actual: findRuntimeRoleGateProblem(realStart),
    expected: null,
  });
  const receipt = readFileSync(receiptModule, 'utf8');
  for (const [shape, source, token] of [
    [
      'a real Next preparation',
      "import next from 'next';\nawait next({ dev: false }).prepare();\n",
      'nextApp.prepare(',
    ],
    [
      'computed Next preparation',
      "await nextApp['prepare']();\n",
      'nextApp.prepare(',
    ],
    [
      'destructured Next preparation',
      'const { prepare: boot } = nextApp;\nawait boot();\n',
      'nextApp.prepare(',
    ],
    ['a listener', 'server.listen(3000);\n', '.listen('],
  ] as const)
    assert({
      given: shape + ' introduced into that same real transitive module',
      should: 'still refuse the startup bypass',
      actual: findRuntimeRoleGateProblem(realStart, {
        [receiptModule]: receipt + '\n' + source,
      }),
      expected: `start.ts loads ${receiptModule}, which bypasses the start-up gate with ${token}; start only through startProductionServer (ISSUE-228)`,
    });
});
