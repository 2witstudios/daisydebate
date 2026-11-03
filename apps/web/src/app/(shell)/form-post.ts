import { headers } from 'next/headers';
import { inProcessFetch } from '../../server/in-process-fetch';

export const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

/** Posts as this request, through the route a script would call. */
export const post = async (
  route: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
) =>
  inProcessFetch(route, new Headers(await headers()))(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
