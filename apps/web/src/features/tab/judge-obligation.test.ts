import { assert, setupRitewayBun, test } from 'riteway/bun';
import { judgesOwed } from './judge-obligation';
import { settingValueSchemas } from '@daisy/protocol/setting-values';
setupRitewayBun();
test('school obligations round each accepted-entry group up without inventing a policy', () => {
  const ratio = {
    kind: 'ratio',
    entriesPerJudge: 2,
    judgesPerGroup: 1,
  } as const;
  assert({
    given:
      'zero, exact and partial groups, an explicit zero obligation, and no policy',
    should: 'owe whole judge groups and preserve unconfigured null',
    actual: [
      judgesOwed(ratio, 0),
      judgesOwed(ratio, 2),
      judgesOwed(ratio, 3),
      judgesOwed({ ...ratio, judgesPerGroup: 0 }, 3),
      judgesOwed({ kind: 'unconfigured' }, 3),
    ],
    expected: [0, 1, 2, 0, null],
  });
  assert({
    given:
      'zero or fractional entries per group and negative or fractional judges',
    should: 'reject policies that cannot describe whole judge obligations',
    actual: [
      { ...ratio, entriesPerJudge: 0 },
      { ...ratio, entriesPerJudge: 1.5 },
      { ...ratio, judgesPerGroup: -1 },
      { ...ratio, judgesPerGroup: 0.5 },
    ].map(
      (value) =>
        settingValueSchemas['entry.judge_obligation'].safeParse(value).success,
    ),
    expected: [false, false, false, false],
  });
});
