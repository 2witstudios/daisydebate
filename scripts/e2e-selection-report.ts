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
      object.tests.length > 0
    )
      found.add(object.file.split('/').at(-1)!);
    Object.values(object).forEach(visit);
  };
  visit(report);
  return selected.filter((spec) => !found.has(spec));
}
if (import.meta.main) {
  const selection = await Bun.file(
    'apps/web/test-results/selection.json',
  ).json();
  const report = await Bun.file('apps/web/test-results/results.json').json();
  if (!Array.isArray(selection.specs) || selection.specs.length === 0)
    throw new Error('Missing selected browser specs');
  const missing = missingSelectedSpecs(selection.specs, report);
  if (missing.length)
    throw new Error(
      `Selected browser specs absent from report: ${missing.join(', ')}`,
    );
}
