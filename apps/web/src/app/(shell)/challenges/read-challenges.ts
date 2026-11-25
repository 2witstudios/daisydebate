import { renderReadHeaders } from '../../../server/render-read';
import { challengeListSchema } from '@daisy/protocol/challenges';
import { headers } from 'next/headers';
import { GET as readChallengesRoute } from '../../api/challenges/route';

/** The viewer's own challenges for the shell's initial view. */
export async function readChallenges() {
  const response = await readChallengesRoute(
    new Request('http://in-process.invalid/api/challenges', {
      headers: renderReadHeaders(await headers()),
    }),
  );
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const parsed = challengeListSchema.loose().safeParse(body);
  return parsed.success ? parsed.data : null;
}
