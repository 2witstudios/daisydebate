import { inProcessFetch } from '../../server/in-process-fetch';

export async function runTabCommandForm<State>({
  post,
  path,
  incoming,
  body,
  answer,
  refused,
  unacknowledged,
  transportFailure,
}: {
  readonly post: (request: Request) => Promise<Response>;
  readonly path: string;
  readonly incoming: Headers;
  readonly body: unknown;
  readonly answer: (body: unknown) => State;
  readonly refused: (status: number) => State;
  readonly unacknowledged: () => State;
  readonly transportFailure?: 'throw';
}): Promise<State> {
  try {
    const response = await inProcessFetch(post, incoming)(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      return response.status >= 500
        ? unacknowledged()
        : refused(response.status);
    return answer(await response.json());
  } catch (error) {
    if (transportFailure === 'throw') throw error;
    return unacknowledged();
  }
}
