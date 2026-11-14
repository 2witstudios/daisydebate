/**
 * The entry a record holds under `key` itself, or null. A key read from an
 * address can name something every object inherits (`constructor`), which a
 * plain lookup would answer with.
 */
export const own = <Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Value | null => (Object.hasOwn(record, key) ? (record[key] ?? null) : null);
