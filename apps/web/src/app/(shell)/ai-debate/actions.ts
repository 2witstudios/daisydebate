'use server';

import { headers } from 'next/headers';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { moveOn } from '../../../server/form-action';
import { processRoute } from '../../../server/process-app';
import { motions } from '../../../features/train/practice';
import type { BotRoomState } from '../../../ui/ai-debate/match/bot-room';

const startRoute = processRoute((routes) => routes.aiDebate.start.POST);

const notices: Readonly<Record<number, string>> = {
  400: 'Write a motion between 3 and 140 characters.',
  401: 'Sign in to debate a bot.',
  403: 'Finish setting up your account to debate a bot.',
  429: 'You have started a lot of debates recently, or Daisy is busy. Try again later.',
  503: 'Bot debates are not available right now.',
};

/** The motion: the person's own words when given, else the chosen sample. */
function motionOf(data: FormData): string {
  const own = String(data.get('own') ?? '').trim();
  if (own) return own.slice(0, 400);
  const index = Number(data.get('motion'));
  return motions[Number.isInteger(index) ? index : 0] ?? motions[0];
}

/**
 * The bot room's POST, as a server action: it runs POST /api/ai-debate/start
 * in process with this request's headers, so the same-origin, session, rate
 * limit and validation gates all apply, then moves on to the debate room.
 * The side may be a coin flip, decided here with the platform CSPRNG.
 */
export async function startAiDebateAction(
  _state: BotRoomState,
  form: unknown,
): Promise<BotRoomState> {
  const data = form instanceof FormData ? form : new FormData();
  const resolution = motionOf(data);
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
        opponent: String(data.get('bot') ?? ''),
      }),
    },
  );
  if (response.status !== 201)
    return {
      notice:
        notices[response.status] ?? 'Could not start the debate. Try again.',
    };
  const { id } = (await response.json()) as { id: string };
  return {
    notice: '',
    ...moveOn(incoming, `/ai-debate/${id}`),
  };
}
