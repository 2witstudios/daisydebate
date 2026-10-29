import { assert, setupRitewayBun, test } from 'riteway/bun';
import { redactText } from './e2e-artifact-sanitizer';
setupRitewayBun();
test('admin artifact publication', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file('.github/workflows/e2e.yml').text(),
  ) as {
    jobs: {
      admin: {
        steps: { id?: string; uses?: string; run?: string; if?: string }[];
      };
    };
  };
  const steps = workflow.jobs.admin.steps;
  const sanitize = steps.findIndex(
    (step) =>
      step.id === 'admin_sanitize' &&
      step.run?.includes(
        'bun scripts/e2e-artifact-sanitizer.ts apps/admin/test-results',
      ),
  );
  const upload = steps.findIndex((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  );
  assert({
    given: 'admin artifacts from a successful or failed browser run',
    should: 'upload only after the sanitizer succeeds',
    actual:
      sanitize >= 0 &&
      upload > sanitize &&
      Boolean(
        steps[upload]?.if?.includes(
          "steps.admin_sanitize.outcome == 'success'",
        ),
      ),
    expected: true,
  });
});
test('admin session artifact redaction', () => {
  const input = JSON.stringify({
    name: 'daisy_admin_session',
    value: 'a'.repeat(43),
  });
  assert({
    given: 'an admin session cookie in a trace record',
    should: 'retain its name and remove its bearer value',
    actual: JSON.parse(redactText(input)),
    expected: { name: 'daisy_admin_session', value: '[REDACTED]' },
  });
});
