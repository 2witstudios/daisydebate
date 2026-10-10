const ready =
  "${{ !cancelled() && steps.doctor.outcome == 'success' && steps.build.outcome == 'success' && steps.chromium.outcome == 'success' }}";
function runnerEnforced(
  step: Record<string, unknown> | null,
  steps: readonly unknown[],
) {
  if (!step) return false;
  if (step.if === undefined) return true;
  if (step.if !== ready) return false;
  const required = [
    ['doctor', 'bun doctor'],
    ['build', 'bun run build'],
    [
      'chromium',
      'bun apps/web/node_modules/@playwright/test/cli.js install --with-deps chromium',
    ],
  ];
  return required.every(([id, command]) =>
    steps.some((value) => {
      const prerequisite = record(value);
      return (
        prerequisite?.id === id &&
        prerequisite.if === undefined &&
        prerequisite['continue-on-error'] === undefined &&
        typeof prerequisite.run === 'string' &&
        prerequisite.run.trim().split('\n')[0] === command
      );
    }),
  );
}
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
function hasReport(steps: readonly unknown[], command: string | undefined) {
  if (!command) return true;
  return steps.some((value) => {
    const step = record(value);
    const enforced =
      step?.if === undefined || step?.if === '${{ always() && !cancelled() }}';
    return (
      enforced &&
      step?.['continue-on-error'] === undefined &&
      typeof step?.run === 'string' &&
      step.run.trim() === command
    );
  });
}
export function claimedBrowserSteps(
  workflow: string,
  command: string,
  reportCommand: string | undefined,
  companions: readonly string[] = [],
): number {
  try {
    const jobs = record(record(Bun.YAML.parse(workflow))?.jobs);
    return Object.values(jobs ?? {}).flatMap((value) => {
      const job = record(value);
      if (
        !job ||
        job.if !== undefined ||
        job['continue-on-error'] !== undefined ||
        !Array.isArray(job.steps)
      )
        return [];
      if (
        !companions.every((command) =>
          job.steps.some((value: unknown) => {
            const step = record(value);
            return (
              runnerEnforced(step, job.steps) &&
              step?.['continue-on-error'] === undefined &&
              typeof step?.run === 'string' &&
              [`bun ${command}`, `bun run ${command}`].includes(step.run.trim())
            );
          }),
        )
      )
        return [];
      if (!hasReport(job.steps, reportCommand)) return [];
      return job.steps.filter((value) => {
        const step = record(value);
        return (
          step &&
          runnerEnforced(step, job.steps) &&
          step['continue-on-error'] === undefined &&
          typeof step.run === 'string' &&
          [`bun ${command}`, `bun run ${command}`].includes(step.run.trim())
        );
      });
    }).length;
  } catch {
    return 0;
  }
}
