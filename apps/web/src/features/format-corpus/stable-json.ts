/** A JSON-able value with every object's keys in code-point order, recursively. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
};

/** The one text a corpus file holds: sorted keys, two-space indent, a final newline. */
export const stableJson = (value: unknown): string =>
  `${JSON.stringify(canonical(value), null, 2)}\n`;
