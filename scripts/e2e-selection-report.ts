/** A nonempty report is insufficient if a config accidentally omits selected specs. */
export function missingSelectedSpecs(
  selected: readonly string[],
  report: unknown,
): readonly string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const object = value as Record<string, unknown>;
    if (
      typeof object.file === 'string' &&
      Array.isArray(object.tests) &&
      object.tests.some((test: { results?: { status?: string }[] }) =>
        test.results?.some((result) => result.status === 'passed'),
      )
    )
      found.add(object.file.split('/').at(-1)!);
    Object.values(object).forEach(visit);
  };
  visit(report);
  return selected.filter((spec) => !found.has(spec));
}
if (import.meta.main) {
  const selection = await Bun.file('.turbo/e2e-selection.json').json();
  const native = Bun.argv[2] === 'room-launch';
  const report = await Bun.file(
    `apps/web/test-results/${native ? 'room-launch-' : ''}results.json`,
  ).json();
  if (native) selection.specs = selection.nativeSpecs;
  if (!Array.isArray(selection.specs) || selection.specs.length === 0)
    throw new Error('Missing selected browser specs');
  const missing = missingSelectedSpecs(selection.specs, report);
  if (missing.length)
    throw new Error(
      `Selected browser specs absent from report: ${missing.join(', ')}`,
    );
}
