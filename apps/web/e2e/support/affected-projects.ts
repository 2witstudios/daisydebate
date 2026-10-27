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

/** CLI regexes narrow execution without changing the admitted full inventory. */
export function nativeSpecArguments(
  value: string | undefined,
  inventory: unknown,
): string[] {
  if (value === undefined) return [];
  const selected: unknown = JSON.parse(value);
  if (
    !Array.isArray(selected) ||
    !selected.includes('room-launch.e2e.ts') ||
    new Set(selected).size !== selected.length ||
    !Array.isArray(inventory) ||
    !selected.every(
      (name) =>
        typeof name === 'string' &&
        /^[a-z][a-z-]*\.e2e\.ts$/.test(name) &&
        inventory.includes(`**/${name}`),
    )
  )
    throw new Error('Invalid native browser selection');
  return selected.map((name) => '(^|/)' + name.replaceAll('.', '\\.') + '$');
}
