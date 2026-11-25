import { headers } from 'next/headers';
import type { ZodType } from 'zod';

/**
 * The headers of a read the server makes for itself while answering a
 * browser request. The browser asked for an HTML document; `Origin` and
 * `Sec-Fetch-Site` describe that navigation, not this read, which originates
 * here. Left in place, a page reached from another site (a link in mail, the
 * return from hosted Checkout) would carry `cross-site` into its own route
 * and be refused its own data. The visitor's session and every other header
 * stay. Only a read drops them: a write keeps the browser's `Origin`, which
 * its same-origin gate requires.
 */
export function renderReadHeaders(navigation: Headers): Headers {
  const read = new Headers(navigation);
  read.delete('origin');
  read.delete('sec-fetch-site');
  return read;
}

/**
 * One read of a route by the render answering `navigation`: null when it is
 * refused, unavailable or off contract.
 */
export async function renderRead<T>(
  get: (request: Request) => Promise<Response>,
  path: string,
  schema: ZodType<T>,
  navigation: Headers,
): Promise<T | null> {
  try {
    const response = await get(
      new Request(`http://in-process.invalid${path}`, {
        headers: renderReadHeaders(navigation),
      }),
    );
    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The viewer's own read for a server render, through the same route a script
 * would call, with this request's session.
 */
export const readOwnRoute = async <T>(
  get: (request: Request) => Promise<Response>,
  path: string,
  schema: ZodType<T>,
): Promise<T | null> => renderRead(get, path, schema, await headers());
