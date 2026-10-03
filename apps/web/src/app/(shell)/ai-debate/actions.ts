'use server';

import { headers } from 'next/headers';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { moveOn } from '../../../server/form-action';
import { processRoute } from '../../../server/process-app';
import type { StartFormState } from '../../../ui/ai-debate/start/start-form';

const startRoute = processRoute((routes) => routes.aiDebate.start.POST);

const notices: Readonly<Record<number, string>> = {
  400: 'Write a resolution between 3 and 200 characters.',
  401: 'Sign in to debate the AI.',
  403: 'Finish setting up your account to debate the AI.',
  429: 'You have started a lot of AI debates recently, or Daisy is busy. Try again later.',
  503: 'AI debates are not available right now.',
};

/**
 * The start form's POST, as a server action: it runs POST /api/ai-debate/start
 * in process with this request's headers, so the same-origin, session, rate
 * limit and validation gates all apply, then moves on to the debate room.
 * The side may be a coin flip, decided here with the platform CSPRNG.
 */
export async function startAiDebateAction(
  _state: StartFormState,
  form: unknown,
): Promise<StartFormState> {
  const data = form instanceof FormData ? form : new FormData();
  const resolution = String(data.get('resolution') ?? '').slice(0, 400);
  const side = String(data.get('side') ?? 'random');
  const personSide =
    side === 'affirmative' || side === 'negative'
      ? side
      : crypto.getRandomValues(new Uint8Array(1))[0]! % 2 === 0
        ? 'affirmative'
        : 'negative';
  const incoming = new Headers(await headers());
  const response = await inProcessFetch(startRoute, incoming)(
    '/api/ai-debate/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolution,
        personSide,
        voice: String(data.get('voice') ?? ''),
      }),
    },
  );
  if (response.status !== 201)
    return {
      resolution,
      notice:
        notices[response.status] ?? 'Could not start the debate. Try again.',
    };
  const { id } = (await response.json()) as { id: string };
  return {
    resolution: '',
    notice: '',
    ...moveOn(incoming, `/ai-debate/${id}`),
  };
}
