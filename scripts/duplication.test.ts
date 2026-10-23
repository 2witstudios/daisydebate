import { assert, setupRitewayBun, test } from 'riteway/bun';
import { runDuplicationScans } from './duplication';

setupRitewayBun();

const scans = async (codes: readonly number[]) => {
  const ran: (readonly string[])[] = [];
  const replies = [...codes];
  const exit = await runDuplicationScans(async (args) => {
    ran.push(args);
    return replies.shift()!;
  });
  return { ran, exit };
};

test('both duplication scans always run and the gate fails if either fails (ISSUE-483)', async () => {
  assert({
    given: 'a red source scan, a red test scan, both red, and both green',
    should:
      'run the source scan then the test scan every time, failing unless both pass',
    actual: await Promise.all(
      [
        [1, 0],
        [0, 1],
        [1, 1],
        [0, 0],
      ].map(scans),
    ),
    expected: [1, 1, 1, 0].map((exit) => ({
      ran: [[], ['--config', '.jscpd-tests.json']],
      exit,
    })),
  });
});
