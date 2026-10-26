/** Invalid selection fails collection; no exclusion is added in full-suite mode. */
export function affectedExclusions(value: string | undefined): string[] {
  if (value === undefined) return [];
  const excluded: unknown = JSON.parse(value);
  if (
    !Array.isArray(excluded) ||
    !excluded.every(
      (name) =>
        typeof name === 'string' && /^[a-z][a-z-]*\.e2e\.ts$/.test(name),
    )
  )
    throw new Error('Invalid affected browser exclusion list');
  return excluded.map((name) => `**/${name}`);
}
