import { headers } from 'next/headers';
import type { ZodType } from 'zod';

/**
 * The viewer's own read for a server render, through the same route a script
 * would call, with this request's headers; null when it is refused,
 * unavailable or off contract.
 */
export async function readOwnRoute<T>(
  get: (request: Request) => Promise<Response>,
  path: string,
  schema: ZodType<T>,
): Promise<T | null> {
  try {
    const response = await get(
      new Request(`http://in-process.invalid${path}`, {
        headers: new Headers(await headers()),
      }),
    );
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
