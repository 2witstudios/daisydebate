import { assertRejects } from '@daisy/errors/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { assertAttendanceRules } from './attendance-policy';
import { attendancePolicy } from './attendance';
import { oneOnOneRules } from './runtime.test-support';
setupRitewayBun();
test('attendance rule guards preserve reconnect grace speech coverage and transaction buffer', async () => {
  const rules = oneOnOneRules();
  for (const fixture of [
    {
      rules,
      policy: { ...attendancePolicy, graceMs: 39999 },
      id: 'debate.rules.check-in-grace-covers-reconnect',
    },
    {
      rules: {
        ...rules,
        segments: rules.segments.map((s, i) =>
          i === 0 ? { ...s, durationMs: 39999 } : s,
        ),
      },
      policy: attendancePolicy,
      id: 'debate.rules.speech-covers-grace',
    },
    {
      rules,
      policy: { ...attendancePolicy, finalizationBufferMs: 2000 },
      id: 'debate.rules.finalization-buffer-covers-commit',
    },
  ])
    await assertRejects({
      given: fixture.id,
      should: 'refuse the exact violated timing invariant',
      actual: () => assertAttendanceRules(fixture.rules, fixture.policy),
      code: 'INVARIANT',
      invariantId: fixture.id,
    });
});
