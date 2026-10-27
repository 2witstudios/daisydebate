import { createId } from '@paralleldrive/cuid2';
import { approveBetaAccounts } from './beta-access';

export type LaunchProbeMember = { readonly cookie: string };
const successful = (response: Response, status: number) => {
  if (response.status !== status)
    throw new Error('Public probe member setup refused');
};
const mailedProbeLink = async (email: string, mailPort: number) => {
  let link: string | undefined;
  const deadline = performance.now() + 10000;
  while (!link) {
    const response = await fetch(
      `http://127.0.0.1:${mailPort}/mails?to=${encodeURIComponent(email)}`,
    );
    if (!response.ok) throw new Error('Public probe mail capture unavailable');
    const mails = (await response.json()) as { text: string }[];
    link = mails.at(-1)?.text.match(/https:\/\/\S+/)?.[0];
    if (!link && performance.now() >= deadline)
      throw new Error('Public probe member mail deadline');
    if (!link) await Bun.sleep(10);
  }
  return link;
};
/** Ordinary mounted authentication, with the same captured mail transport as browser sign-up. */
export async function createLaunchProbeMember(
  origin: string,
  mailPort: number,
): Promise<LaunchProbeMember> {
  const email = `probe${createId()}@example.test`;
  successful(
    await fetch(`${origin}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: '/lobby' }),
    }),
    200,
  );
  const link = await mailedProbeLink(email, mailPort);
  const token = new URL(link).searchParams.get('token');
  if (!token) throw new Error('Public probe member confirmation missing');
  const confirmed = await fetch(`${origin}/auth/confirm`, {
    method: 'POST',
    redirect: 'manual',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, callbackURL: '/lobby' }),
  });
  successful(confirmed, 303);
  const cookie = confirmed.headers
    .getSetCookie()
    .map((part) => part.split(';')[0]!)
    .join('; ');
  if (!cookie) throw new Error('Public probe member session missing');
  // The age step comes before the username claim (WAIT-4.6), as an adult.
  successful(
    await fetch(`${origin}/api/account/age`, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ month: 1, year: 1990, terms: true }),
    }),
    200,
  );
  successful(
    await fetch(`${origin}/api/account/username`, {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ username: `probe${createId().slice(0, 16)}` }),
    }),
    201,
  );
  // A claimed account waits on the beta list until approved (ADR 0075).
  await approveBetaAccounts(email);
  const identified = await fetch(`${origin}/api/auth/get-session`, {
    headers: { cookie },
  });
  successful(identified, 200);
  const session = (await identified.json()) as { user?: { username?: string } };
  if (!session.user?.username)
    throw new Error('Public probe signed member identification failed');
  return { cookie };
}
