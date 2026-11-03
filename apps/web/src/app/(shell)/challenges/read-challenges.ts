import { challengeListSchema } from '@daisy/protocol';
import { headers } from 'next/headers';
import { GET as readChallengesRoute } from '../../api/challenges/route';

/** The viewer's own challenges, and the actor id their inbox doorbell names. */
export async function readChallenges() {
  const response = await readChallengesRoute(
    new Request('http://in-process.invalid/api/challenges', {
      headers: new Headers(await headers()),
    }),
  );
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const parsed = challengeListSchema.loose().safeParse(body);
  if (!parsed.success) return null;
  const actorId = parsed.data['actorId'];
  return {
    list: parsed.data,
    actorId: typeof actorId === 'string' ? actorId : null,
    socketUrl: response.headers.get('x-realtime-socket-url'),
  };
}
