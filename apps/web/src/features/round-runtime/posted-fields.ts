/** Strict flat form collection shared by competitive command and ballot encodings. */
export function collectRoundFormFields(
  entries: Iterable<readonly [string, unknown]>,
  allowed: readonly string[],
  serverAction = false,
  actionOnly: readonly string[] = [],
) {
  const fields: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (
      serverAction &&
      (key.startsWith('$ACTION_') || actionOnly.includes(key))
    )
      continue;
    if (!allowed.includes(key) || key in fields || typeof value !== 'string')
      return null;
    fields[key] = value;
  }
  return fields;
}
export const positiveFormInteger = (value: string | undefined): number =>
  value !== undefined && /^[1-9][0-9]*$/.test(value) ? Number(value) : NaN;
