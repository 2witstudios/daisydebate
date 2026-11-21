import { challengeListSchema } from '@daisy/protocol';
import { headers } from 'next/headers';
import { GET as readChallengesRoute } from '../../api/challenges/route';

/** The viewer's own challenges for the shell's initial view. */
export async function readChallenges() {
  const response = await readChallengesRoute(
    new Request('http://in-process.invalid/api/challenges', {
      headers: new Headers(await headers()),
    }),
  );
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const parsed = challengeListSchema.loose().safeParse(body);
  return parsed.success ? parsed.data : null;
}
