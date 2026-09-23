/**
 * `REALTIME_PORT`, not `PORT`: `apps/web` already reads `PORT` for its own
 * listener, and `bun dev`/`bun dev:agent` run both apps in one environment.
 */
export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)
    throw new Error(`Invalid REALTIME_PORT: ${value}`);
  return parsed;
}
