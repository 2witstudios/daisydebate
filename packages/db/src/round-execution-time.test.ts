import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoundExecutionTime } from './round-execution-time';
import { isAppError } from '@daisy/errors';
setupRitewayBun();
test('Round time keeps production DB sampling and admits only explicit trusted UTC resources', async () => {
  const statements: string[] = [];
  const tx = {
    execute: async () => {
      statements.push('database clock');
      return [{ now: new Date('2026-11-16T01:00:00.123Z') }];
    },
  } as unknown as Parameters<typeof sampleRoundExecutionTime>[0];
  const actual = await sampleRoundExecutionTime(tx);
  const controlled = await sampleRoundExecutionTime(
    tx,
    async () => '2026-11-16T02:00:00.123Z',
  );
  let invalid = false;
  try {
    await sampleRoundExecutionTime(tx, async () => '2026-11-16T02:00:00+01:00');
  } catch (error) {
    if (!isAppError(error)) throw error;
    invalid = error.code === 'INVARIANT';
  }
  assert({
    given:
      'the default production sample and a distinct explicit trusted UTC resource',
    should:
      'read SQL by default, consume the explicit resource without SQL, and refuse non-UTC time',
    actual: [actual, controlled, statements, invalid],
    expected: [
      '2026-11-16T01:00:00.123Z',
      '2026-11-16T02:00:00.123Z',
      ['database clock'],
      true,
    ],
  });
});
